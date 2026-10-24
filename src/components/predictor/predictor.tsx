"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { VehicleOptions } from "@/lib/model-store";
import type { DealCheckResult } from "@/lib/deal-check";
import type { ParsedListing } from "@/lib/parse-listing";
import type { PredictionResult } from "@/ml/predict";
import { DealCard } from "./deal-card";
import { ResultPanel } from "./result-panel";

type TriState = "" | "yes" | "no";

interface FormState {
  manufacturer: string;
  model: string;
  year: string;
  mileage: string;
  fuel_type: string;
  transmission: string;
  body_type: string;
  drivetrain: string;
  engine_size: string;
  condition: string;
  owners: string;
  accident_history: TriState;
  asking_price: string;
}

type Preset = Partial<FormState> & { manufacturer: string; model: string };

const PRESETS: { label: string; values: Preset }[] = [
  { label: "2020 Toyota RAV4 Hybrid", values: { manufacturer: "Toyota", model: "RAV4", year: "2020", mileage: "45000", fuel_type: "Hybrid", transmission: "Automatic", drivetrain: "AWD", condition: "Good", owners: "1", accident_history: "no" } },
  { label: "2016 BMW 3 Series", values: { manufacturer: "BMW", model: "3 Series", year: "2016", mileage: "82000", fuel_type: "Gasoline", transmission: "Automatic", drivetrain: "RWD", engine_size: "2.0", condition: "Fair", owners: "2", accident_history: "yes" } },
  { label: "2022 Tesla Model 3", values: { manufacturer: "Tesla", model: "Model 3", year: "2022", mileage: "28000", fuel_type: "Electric", transmission: "Automatic", condition: "Excellent", owners: "1", accident_history: "no" } },
  { label: "2014 Ford F-150 4x4", values: { manufacturer: "Ford", model: "F-150", year: "2014", mileage: "128000", fuel_type: "Gasoline", transmission: "Automatic", drivetrain: "4WD", engine_size: "3.5", condition: "Fair", owners: "3", accident_history: "no" } },
  { label: "2012 Porsche 911 manual", values: { manufacturer: "Porsche", model: "911", year: "2012", mileage: "54000", fuel_type: "Gasoline", transmission: "Manual", body_type: "Coupe", drivetrain: "RWD", engine_size: "3.8", condition: "Excellent", owners: "2", accident_history: "no" } },
];

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400";

// the api accepts these years; anything else in the form is blank rather than guessed
const MIN_YEAR = 1980;

/**
 * form state for a make/model. it never invents a value: what the person entered is kept, a field is
 * only filled when the model leaves one possible answer (an electric-only model is electric), and
 * everything else stays blank, so it is either asked for or imputed and listed as such.
 */
function stateForModel(options: VehicleOptions, manufacturer: string, modelName: string, keep?: Partial<FormState>): FormState {
  const make = options.manufacturers.find((m) => m.name === manufacturer) ?? options.manufacturers[0];
  const model = make.models.find((m) => m.name === modelName) ?? make.models[0];
  const keptYear = Number(keep?.year);
  const year = keep?.year && keptYear >= MIN_YEAR && keptYear <= options.reference_year + 1 ? keep.year : "";
  const pick = (kept: string | undefined, seen: string[]) => (kept && seen.includes(kept) ? kept : seen.length === 1 ? seen[0] : "");
  const fuel_type = pick(keep?.fuel_type, model.fuelTypes);
  return {
    manufacturer: make.name,
    model: model.name,
    year,
    mileage: keep?.mileage ?? "",
    fuel_type,
    transmission: fuel_type === "Electric" ? "Automatic" : pick(keep?.transmission, model.transmissions),
    body_type: "",
    drivetrain: "",
    engine_size: "",
    condition: keep?.condition ?? "",
    owners: keep?.owners ?? "",
    accident_history: keep?.accident_history ?? "",
    asking_price: keep?.asking_price ?? "",
  };
}

function applyPreset(options: VehicleOptions, preset: Preset): FormState {
  return { ...stateForModel(options, preset.manufacturer, preset.model, preset), ...preset };
}

function toPayload(form: FormState): Record<string, unknown> {
  return {
    manufacturer: form.manufacturer,
    model: form.model,
    year: Number(form.year),
    mileage: Number(form.mileage),
    fuel_type: form.fuel_type || null,
    transmission: form.transmission || null,
    body_type: form.body_type || null,
    drivetrain: form.drivetrain || null,
    engine_size: form.engine_size === "" ? null : Number(form.engine_size),
    condition: form.condition || null,
    owners: form.owners === "" ? null : Number(form.owners),
    accident_history: form.accident_history === "" ? null : form.accident_history === "yes",
  };
}

/** maps fields the ai extracted onto the form; only known makes/models are applied */
function formFromParsed(options: VehicleOptions, p: ParsedListing, prev: FormState): { form: FormState; note: string } {
  const make = options.manufacturers.find((m) => m.name === p.manufacturer);
  if (!make) return { form: prev, note: "Couldn't match the make to a car we know. Fill the form below instead." };
  const model = make.models.find((m) => m.name === p.model);
  // unknown model: fall back to the most common one that fits the stated year and fuel, and say so
  const fits = (m: (typeof make.models)[number]) =>
    (!p.year || (p.year >= m.years[0] && p.year <= m.years[1])) && (!p.fuel_type || m.fuelTypes.includes(p.fuel_type));
  const chosen = model ?? [...make.models].sort((a, b) => b.count - a.count).find(fits) ?? make.models[0];
  // only what the listing states; everything else is left blank instead of guessed
  const keep: Partial<FormState> = {
    year: p.year ? String(p.year) : "",
    mileage: p.mileage != null ? String(p.mileage) : "",
    fuel_type: p.fuel_type ?? undefined,
    transmission: p.transmission ?? undefined,
    condition: p.condition ?? "",
    owners: p.owners ? String(p.owners) : "",
    accident_history: p.accident_history == null ? "" : p.accident_history ? "yes" : "no",
    asking_price: p.asking_price ? String(p.asking_price) : "",
  };
  const form = stateForModel(options, make.name, chosen.name, keep);
  // a stated value wins even when it is unusual for the model; the form flags it rather than hiding it
  if (p.fuel_type) form.fuel_type = p.fuel_type;
  if (p.transmission) form.transmission = p.transmission;
  if (p.body_type) form.body_type = p.body_type;
  if (p.drivetrain) form.drivetrain = p.drivetrain;
  if (p.engine_size != null) form.engine_size = String(p.engine_size);
  const count = p.filled.length;
  const missing = [!form.year && "model year", !form.mileage && "mileage"].filter(Boolean) as string[];
  const head = model
    ? `Filled ${count} field${count === 1 ? "" : "s"} from your description.`
    : `Found ${make.name}, but not that model, so the ${chosen.name} is selected. Change it if that's wrong.`;
  const tail = missing.length
    ? ` The listing doesn't say the ${missing.join(" or ")}. Add ${missing.length === 1 ? "it" : "them"} below to continue.`
    : " Check the fields, then run the estimate.";
  return { form, note: head + tail };
}

function describeError(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as { error?: string; details?: { field: string; message: string }[] };
    if (Array.isArray(d.details) && d.details.length > 0) return d.details.map((x) => `${x.field}: ${x.message}`).join(" · ");
    if (d.error) return d.error;
  }
  return "Prediction failed";
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">{label}</label>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options, available }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  available?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((option) => {
        const active = option.value === value;
        const unusual = available && option.value !== "" && !available.includes(option.value);
        return (
          <button
            key={option.value || "unknown"}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={unusual ? "Not seen for this model in the training data" : undefined}
            className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
              active ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"
            } ${unusual && !active ? "opacity-50" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Predictor({ options, model, aiEnabled = false }: {
  options: VehicleOptions;
  model: { label: string; r2: number; mape: number };
  aiEnabled?: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => applyPreset(options, PRESETS[0].values));
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [deal, setDeal] = useState<Omit<DealCheckResult, "prediction"> | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // inputs behind the result on screen, so edits after a check can be flagged
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [listingText, setListingText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);

  const make = useMemo(
    () => options.manufacturers.find((m) => m.name === form.manufacturer) ?? options.manufacturers[0],
    [options, form.manufacturer],
  );
  const modelInfo = useMemo(() => make.models.find((m) => m.name === form.model) ?? make.models[0], [make, form.model]);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = Math.min(options.reference_year, modelInfo.years[1]); y >= modelInfo.years[0]; y--) list.push(y);
    return list;
  }, [options.reference_year, modelInfo]);

  // choices the training data never saw for this model: shown next to the form, not hidden
  const modelName = `${form.manufacturer} ${form.model}`;
  const mismatches: string[] = [];
  const yearNum = Number(form.year);
  if (form.year && (yearNum < modelInfo.years[0] || yearNum > modelInfo.years[1])) {
    mismatches.push(`${form.year}: the ${modelName} was only seen from ${modelInfo.years[0]} to ${modelInfo.years[1]}.`);
  }
  const flag = (label: string, value: string, seen: string[]) => {
    if (value && seen.length > 0 && !seen.includes(value)) mismatches.push(`${label} ${value}: the ${modelName} was only seen as ${seen.join(", ")}.`);
  };
  flag("Fuel", form.fuel_type, modelInfo.fuelTypes);
  flag("Transmission", form.transmission, modelInfo.transmissions);
  flag("Body", form.body_type, modelInfo.bodyTypes);
  flag("Drivetrain", form.drivetrain, modelInfo.drivetrains);
  const engineNum = Number(form.engine_size);
  if (form.fuel_type !== "Electric" && form.engine_size !== "" && engineNum > 0) {
    if (modelInfo.engineSizes.length === 0) {
      mismatches.push(`Engine ${form.engine_size} L: the ${modelName} was only seen as ${modelInfo.fuelTypes.join(", ")}, with no engine.`);
    } else if (engineNum < Math.min(...modelInfo.engineSizes) - 0.5 || engineNum > Math.max(...modelInfo.engineSizes) + 0.5) {
      mismatches.push(`Engine ${form.engine_size} L: the ${modelName} was only seen with ${modelInfo.engineSizes.join(", ")} L.`);
    }
  }
  const yearOptions = form.year && !years.includes(yearNum) ? [...years, yearNum].sort((a, b) => b - a) : years;

  const formKey = (f: FormState) => JSON.stringify({ ...toPayload(f), asking_price: f.asking_price });
  const stale = result !== null && !loading && submittedKey !== null && submittedKey !== formKey(form);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const isElectric = form.fuel_type === "Electric";

  async function fillFromText() {
    setParsing(true);
    setParseNote(null);
    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: listingText }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        setParseNote(`${describeError(data)}. You can still fill the form below.`);
        return;
      }
      const { form: next, note } = formFromParsed(options, data as ParsedListing, form);
      setForm(next);
      setParseNote(note);
    } catch {
      setParseNote("Network error. You can still fill the form below.");
    } finally {
      setParsing(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    const body = toPayload(form);
    const asking = Number(form.asking_price);
    const withDeal = form.asking_price !== "" && asking > 0;
    try {
      // with an asking price we call the deal check, otherwise just the price estimate
      const response = await fetch(withDeal ? "/api/deal" : "/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client": "web" },
        body: JSON.stringify(withDeal ? { ...body, asking_price: asking } : body),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        setError(describeError(data));
        return;
      }
      if (withDeal) {
        const { prediction, ...rest } = data as DealCheckResult;
        setResult(prediction);
        setDeal(rest);
      } else {
        setResult(data as PredictionResult);
        setDeal(null);
      }
      setPayload(body);
      setSubmittedKey(formKey(form));
    } catch {
      setError("Network error — the prediction API could not be reached.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8 lg:col-span-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Vehicle details</h2>
            <p className="mt-1 text-sm text-slate-500">The six core inputs are required — everything else is optional and imputed if unknown.</p>
          </div>
        </div>

        {aiEnabled && (
          <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <label htmlFor="listing_text" className="text-sm font-medium text-slate-700">
              Describe the car or paste a listing <span className="font-normal text-slate-500">— AI fills the form</span>
            </label>
            <textarea
              id="listing_text"
              rows={2}
              maxLength={2000}
              className={`${inputClass} mt-2 resize-y`}
              placeholder="e.g. 2019 Honda Civic EX, 64k miles, automatic, one owner, no accidents, asking $17,900"
              value={listingText}
              onChange={(e) => setListingText(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void fillFromText()}
                disabled={parsing || listingText.trim().length < 5}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {parsing ? "Reading…" : "Fill the form"}
              </button>
              {parseNote && <p className="text-sm text-slate-600" role="status">{parseNote}</p>}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="self-center text-xs font-medium text-slate-400">Try:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setForm(applyPreset(options, preset.values))}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Manufacturer" htmlFor="manufacturer">
            <select
              id="manufacturer"
              className={inputClass}
              value={form.manufacturer}
              onChange={(e) => {
                const next = options.manufacturers.find((m) => m.name === e.target.value);
                if (next) setForm((prev) => stateForModel(options, next.name, next.models[0].name, prev));
              }}
            >
              {options.manufacturers.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Model" htmlFor="model" hint={`${formatCount(modelInfo.count)} listings in training data`}>
            <select
              id="model"
              className={inputClass}
              value={form.model}
              onChange={(e) => setForm((prev) => stateForModel(options, prev.manufacturer, e.target.value, prev))}
            >
              {make.models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Model year" htmlFor="year">
            <select id="year" required className={inputClass} value={form.year} onChange={(e) => update("year", e.target.value)}>
              {form.year === "" && <option value="">Select the year</option>}
              {yearOptions.map((y) => (
                <option key={y} value={y}>{years.includes(y) ? y : `${y} (not in data for this model)`}</option>
              ))}
            </select>
          </Field>
          <Field label="Mileage" htmlFor="mileage" hint="miles">
            <input
              id="mileage"
              type="number"
              min={0}
              max={1000000}
              step={1}
              required
              className={inputClass}
              value={form.mileage}
              onChange={(e) => update("mileage", e.target.value)}
            />
            <input
              type="range"
              min={0}
              max={Math.max(300000, Math.ceil((Number(form.mileage) || 0) / 1000) * 1000)}
              step={1000}
              aria-label="Mileage slider"
              className="mt-3 w-full accent-indigo-600"
              value={Number(form.mileage) || 0}
              onChange={(e) => update("mileage", e.target.value)}
            />
          </Field>
          <Field label="Fuel type">
            <Segmented
              value={form.fuel_type}
              onChange={(v) => setForm((prev) => ({ ...prev, fuel_type: v, ...(v === "Electric" ? { transmission: "Automatic", engine_size: "" } : {}) }))}
              options={[{ value: "", label: "Not sure" }, ...options.fuel_types.map((f) => ({ value: f, label: f }))]}
              available={modelInfo.fuelTypes}
            />
          </Field>
          <Field label="Transmission">
            <Segmented
              value={form.transmission}
              onChange={(v) => update("transmission", v)}
              options={[{ value: "", label: "Not sure" }, ...options.transmissions.map((t) => ({ value: t, label: t }))]}
              available={isElectric ? ["Automatic"] : modelInfo.transmissions}
            />
          </Field>
        </div>

        {mismatches.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <p className="font-semibold">Not seen for this model in the training data, so the estimate will be unreliable:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {mismatches.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <details open className="group mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800">
            <span>
              Other characteristics <span className="ml-1 font-normal text-slate-500">— optional, improves accuracy</span>
            </span>
            <span className="text-slate-400 transition group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Body type" htmlFor="body_type">
              <select id="body_type" className={inputClass} value={form.body_type} onChange={(e) => update("body_type", e.target.value)}>
                <option value="">Auto ({modelInfo.bodyTypes[0] ?? "most common"})</option>
                {options.body_types.map((b) => (
                  <option key={b} value={b}>{modelInfo.bodyTypes.includes(b) ? b : `${b} (not seen for this model)`}</option>
                ))}
              </select>
            </Field>
            <Field label="Drivetrain" htmlFor="drivetrain">
              <select id="drivetrain" className={inputClass} value={form.drivetrain} onChange={(e) => update("drivetrain", e.target.value)}>
                <option value="">Auto ({modelInfo.drivetrains[0] ?? "most common"})</option>
                {options.drivetrains.map((d) => (
                  <option key={d} value={d}>{modelInfo.drivetrains.includes(d) ? d : `${d} (not seen for this model)`}</option>
                ))}
              </select>
            </Field>
            <Field label="Engine size" htmlFor="engine_size" hint="litres">
              <input
                id="engine_size"
                type="number"
                min={0}
                max={10}
                step={0.1}
                disabled={isElectric}
                className={inputClass}
                placeholder={isElectric ? "Not applicable (electric)" : modelInfo.engineSizes.length ? `Auto · e.g. ${modelInfo.engineSizes.slice(0, 4).join(" / ")}` : "Auto"}
                value={isElectric ? "" : form.engine_size}
                onChange={(e) => update("engine_size", e.target.value)}
              />
            </Field>
            <Field label="Previous owners" htmlFor="owners">
              <select id="owners" className={inputClass} value={form.owners} onChange={(e) => update("owners", e.target.value)}>
                <option value="">Not sure</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Condition">
              <Segmented
                value={form.condition}
                onChange={(v) => update("condition", v)}
                options={[{ value: "", label: "Not sure" }, ...options.conditions.map((c) => ({ value: c, label: c }))]}
              />
            </Field>
            <Field label="Accident history">
              <Segmented
                value={form.accident_history}
                onChange={(v) => update("accident_history", v as TriState)}
                options={[
                  { value: "", label: "Not sure" },
                  { value: "no", label: "No accidents" },
                  { value: "yes", label: "Reported" },
                ]}
              />
            </Field>
          </div>
        </details>

        <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
          <Field label="Asking price" htmlFor="asking_price" hint="optional · USD">
            <input
              id="asking_price"
              type="number"
              min={1}
              max={5000000}
              step="any"
              inputMode="numeric"
              placeholder="e.g. 18500 — add it to check if the listing is a good deal"
              className={inputClass}
              value={form.asking_price}
              onChange={(e) => update("asking_price", e.target.value)}
            />
          </Field>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-wait disabled:opacity-70"
        >
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {loading ? "Estimating…" : form.asking_price ? "Check this deal" : "Estimate price"}
        </button>
      </form>

      <div className="lg:col-span-5">
        <div className="space-y-4 lg:sticky lg:top-20">
          {stale && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900" role="status">
              You changed the details. Press “{form.asking_price ? "Check this deal" : "Estimate price"}” to update this result.
            </p>
          )}
          <div className={stale ? "space-y-4 opacity-40 transition-opacity" : "space-y-4 transition-opacity"}>
            {deal && result && !loading && <DealCard deal={deal.deal} factors={deal.factors} warnings={result.warnings} />}
            <ResultPanel result={result} payload={payload} loading={loading} error={error} model={model} />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCount(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}
