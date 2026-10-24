/**
 * Inference service: validated input → canonical vehicle → imputation → 3 model predictions,
 * calibrated price range and a 5-year depreciation forecast.
 */
import type { CatalogModel, ModelArtifact } from "./artifact";
import { predictLogAll, predictLogWith, type FittedPipeline } from "./ensemble";
import {
  cleanText,
  normalizeAccident,
  normalizeBody,
  normalizeCondition,
  normalizeDrivetrain,
  normalizeFuel,
  normalizeTransmission,
  resolveManufacturerAlias,
} from "./normalize";
import { imputeRecord } from "./preprocess";
import { CONDITIONS, MODEL_LABELS, MODEL_NAMES, type CompleteVehicle, type ModelName, type VehicleRecord } from "./schema";

export interface PredictionInput {
  manufacturer: string;
  model: string;
  year: number;
  mileage?: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  body_type?: string | null;
  drivetrain?: string | null;
  engine_size?: number | null;
  condition?: string | null;
  owners?: number | null;
  accident_history?: boolean | string | null;
}

export interface ForecastPoint {
  year: number;
  vehicle_age: number;
  mileage: number;
  estimated_price: number;
}

export interface PredictionResult {
  estimated_price: number;
  currency: "USD";
  price_range: { low: number; high: number; confidence: number };
  model_used: ModelName;
  model_label: string;
  model_version: string;
  model_predictions: Record<ModelName, number>;
  vehicle: CompleteVehicle;
  imputed_fields: string[];
  warnings: string[];
  depreciation_forecast: ForecastPoint[];
}

const roundPrice = (value: number) => Math.max(0, Math.round(value / 50) * 50);

// trees learn price in steps, so a low-mileage car can land on a slightly cheaper step.
// a car never gains value from extra miles: take the best estimate over a 1,000-mile grid from
// this mileage upward. a lower mileage always sees a superset of points, so price never rises.
const MILEAGE_STEP = 1_000;
const MILEAGE_GRID_MAX = 400_000;

function mileageLogs(fitted: FittedPipeline, vehicle: CompleteVehicle): Record<ModelName, number> {
  const start = Math.floor(vehicle.mileage / MILEAGE_STEP) * MILEAGE_STEP;
  const logs = predictLogAll(fitted, { ...vehicle, mileage: start });
  for (let miles = start + MILEAGE_STEP; miles <= MILEAGE_GRID_MAX; miles += MILEAGE_STEP) {
    const more = predictLogAll(fitted, { ...vehicle, mileage: miles });
    for (const name of MODEL_NAMES) logs[name] = Math.max(logs[name], more[name]);
  }
  return logs;
}

// same idea for condition: a car in better condition is never worth less than the same car in worse condition
function monotoneLogs(fitted: FittedPipeline, vehicle: CompleteVehicle): Record<ModelName, number> {
  const logs = mileageLogs(fitted, vehicle);
  for (const condition of CONDITIONS.slice(CONDITIONS.indexOf(vehicle.condition) + 1)) {
    const worse = mileageLogs(fitted, { ...vehicle, condition });
    for (const name of MODEL_NAMES) logs[name] = Math.max(logs[name], worse[name]);
  }
  return logs;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const compact = (s: string) => words(s).replace(/ /g, "");

/**
 * matches a model name to the catalogue, tolerating trims and spacing:
 * exact ("cr v" -> CR-V), leading words ("civic ex" -> Civic, "f150 xlt" -> F-150),
 * then a unique catalogue name containing the leading words ("silverado 4x4" -> Silverado 1500).
 */
export function findModel<T extends { name: string }>(models: T[], text: string): T | undefined {
  const tokens = words(text).split(" ").filter(Boolean);
  for (let k = tokens.length; k >= 1; k--) {
    const head = tokens.slice(0, k).join("");
    const hit = models.find((m) => compact(m.name) === head);
    if (hit) return hit;
  }
  for (let k = tokens.length; k >= 1; k--) {
    const phrase = ` ${tokens.slice(0, k).join(" ")} `;
    if (phrase.trim().length < 3) continue;
    const hits = models.filter((m) => ` ${words(m.name)} `.includes(phrase));
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

/** Case-insensitive match of make/model against the training catalogue (aliases resolved). */
export function resolveVehicleIdentity(artifact: ModelArtifact, manufacturerInput: string, modelInput: string) {
  const makeText = cleanText(manufacturerInput) ?? "";
  const alias = resolveManufacturerAlias(makeText);
  const wanted = (alias ?? makeText).toLowerCase();
  const make = artifact.catalog.find((m) => m.name.toLowerCase() === wanted);
  const modelText = cleanText(modelInput) ?? "";
  const model = make ? findModel(make.models, modelText) : undefined;
  return {
    manufacturer: make?.name ?? alias ?? makeText,
    model: model?.name ?? modelText,
    knownManufacturer: Boolean(make),
    knownModel: Boolean(model),
    entry: model,
  };
}

const MAX_MILES_PER_YEAR = 50_000;
const ENGINE_TOLERANCE_L = 0.5;
const list = (values: readonly (string | number)[]) => values.join(", ");

/**
 * flags inputs that contradict what the training data knows about this model.
 * the estimate is still returned, but the caller is told it rests on a combination the models never saw.
 */
function consistencyWarnings(
  entry: CatalogModel,
  name: string,
  record: VehicleRecord,
  datasetYears: [number, number],
  referenceYear: number,
): string[] {
  const out: string[] = [];
  const [y0, y1] = entry.years;
  const inDataset = record.year >= datasetYears[0] && record.year <= datasetYears[1];
  if (inDataset && (record.year < y0 || record.year > y1)) {
    out.push(`The ${name} was only seen from ${y0} to ${y1}; a ${record.year} is outside that range, so treat the estimate as an extrapolation.`);
  }
  const check = (field: string, value: string | null, seen: string[]) => {
    if (value && seen.length > 0 && !seen.includes(value)) {
      out.push(`The training data has no ${name} with ${field} "${value}" (seen: ${list(seen)}); the estimate is unreliable.`);
    }
  };
  check("fuel type", record.fuel_type, entry.fuelTypes);
  check("transmission", record.transmission, entry.transmissions);
  check("body type", record.body_type, entry.bodyTypes);
  check("drivetrain", record.drivetrain, entry.drivetrains);
  const engine = record.engine_size;
  if (record.fuel_type !== "Electric" && engine !== null && engine > 0 && entry.engineSizes.length === 0) {
    out.push(`The training data has no ${name} with an engine (it only comes as ${list(entry.fuelTypes)}); the estimate is unreliable.`);
  } else if (record.fuel_type !== "Electric" && engine !== null && engine > 0) {
    const lo = Math.min(...entry.engineSizes) - ENGINE_TOLERANCE_L;
    const hi = Math.max(...entry.engineSizes) + ENGINE_TOLERANCE_L;
    if (engine < lo || engine > hi) {
      out.push(`A ${engine} L engine was never seen for the ${name} (seen: ${list(entry.engineSizes)} L); the estimate is unreliable.`);
    }
  }
  if (record.mileage !== null) {
    const years = Math.max(1, referenceYear - record.year);
    const perYear = record.mileage / years;
    if (perYear > MAX_MILES_PER_YEAR) {
      out.push(
        `${Math.round(record.mileage).toLocaleString("en-US")} miles on a ${record.year} is about ${Math.round(perYear).toLocaleString("en-US")} miles a year, far above normal; check the odometer reading.`,
      );
    }
  }
  return out;
}

export function predictPrice(
  artifact: ModelArtifact,
  input: PredictionInput,
  options: { forecastYears?: number } = {},
): PredictionResult {
  const warnings: string[] = [];
  const identity = resolveVehicleIdentity(artifact, input.manufacturer, input.model);
  if (!identity.knownManufacturer) {
    warnings.push(
      `Manufacturer "${identity.manufacturer}" is not in the training data — the estimate relies on generic vehicle characteristics only.`,
    );
  } else if (!identity.knownModel) {
    warnings.push(`Model "${identity.model}" was not seen for ${identity.manufacturer}; manufacturer-level information is used instead.`);
  }

  const [minYear, maxYear] = artifact.dataset.yearRange;
  if (input.year < minYear) {
    warnings.push(`Model year ${input.year} is older than any vehicle in the training data (${minYear}); treat the estimate as an extrapolation.`);
  } else if (input.year > maxYear) {
    warnings.push(`Model year ${input.year} is newer than the training data (${maxYear}); the estimate assumes a ${maxYear} vehicle.`);
  }
  const mileage = input.mileage ?? null;
  if (mileage !== null && mileage > 300_000) {
    warnings.push("Very high mileage — few comparable listings exist, so the estimate is less certain.");
  }

  const record: VehicleRecord = {
    manufacturer: identity.manufacturer,
    model: identity.model,
    year: Math.round(input.year),
    mileage,
    fuel_type: normalizeFuel(input.fuel_type),
    transmission: normalizeTransmission(input.transmission),
    body_type: normalizeBody(input.body_type),
    drivetrain: normalizeDrivetrain(input.drivetrain),
    engine_size: input.engine_size ?? null,
    condition: normalizeCondition(input.condition),
    owners: input.owners ?? null,
    accident_history: normalizeAccident(input.accident_history),
  };
  if (record.fuel_type === "Electric" && record.engine_size !== null && record.engine_size > 0) {
    warnings.push("Engine size is ignored for electric vehicles.");
    record.engine_size = 0;
  }
  if (identity.entry) {
    const name = `${identity.manufacturer} ${identity.model}`;
    warnings.push(...consistencyWarnings(identity.entry, name, record, [minYear, maxYear], artifact.referenceYear));
  }

  const fitted: FittedPipeline = { preprocessor: artifact.preprocessor, models: artifact.models };
  const { vehicle, imputed } = imputeRecord(fitted.preprocessor, record);
  const logs = monotoneLogs(fitted, vehicle);
  const best = artifact.bestModel;
  const point = Math.exp(logs[best]);
  const q = artifact.evaluation[best].residualQuantiles;

  const model_predictions = {} as Record<ModelName, number>;
  for (const name of MODEL_NAMES) model_predictions[name] = roundPrice(Math.exp(logs[name]));

  // What will the car be worth in the coming years if it keeps its current usage pattern?
  const years = options.forecastYears ?? 5;
  // the models cap age internally; anything shown to people uses the real age
  const age = Math.max(0, artifact.referenceYear - vehicle.year);
  const annualMiles =
    age >= 1 ? Math.min(30_000, Math.max(4_000, vehicle.mileage / age)) : artifact.preprocessor.imputation.milesPerYear;
  const depreciation_forecast: ForecastPoint[] = [];
  let previous = point;
  for (let k = 0; k <= years; k++) {
    const future: CompleteVehicle = { ...vehicle, year: vehicle.year - k, mileage: Math.round(vehicle.mileage + annualMiles * k) };
    const value = k === 0 ? point : Math.min(previous, Math.exp(predictLogWith(fitted, best, future)));
    previous = value;
    depreciation_forecast.push({
      year: artifact.referenceYear + k,
      vehicle_age: age + k,
      mileage: future.mileage,
      estimated_price: roundPrice(value),
    });
  }

  return {
    estimated_price: roundPrice(point),
    currency: "USD",
    price_range: {
      low: roundPrice(point * Math.exp(q.q10)),
      high: roundPrice(point * Math.exp(q.q90)),
      confidence: 0.8,
    },
    model_used: best,
    model_label: MODEL_LABELS[best],
    model_version: artifact.version,
    model_predictions,
    vehicle: {
      ...vehicle,
      mileage: Math.round(vehicle.mileage),
      engine_size: Math.round(vehicle.engine_size * 10) / 10,
    },
    imputed_fields: imputed,
    warnings,
    depreciation_forecast,
  };
}
