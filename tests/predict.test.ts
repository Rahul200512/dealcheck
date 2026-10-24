import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelArtifact } from "@/ml/artifact";
import { findModel, predictPrice, resolveVehicleIdentity, type PredictionInput } from "@/ml/predict";
import { MODEL_NAMES } from "@/ml/schema";

// Behavioural tests against the saved production artifact.
const artifact = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "models", "car_price_model.json"), "utf8"),
) as ModelArtifact;

const camry: PredictionInput = {
  manufacturer: "Toyota",
  model: "Camry",
  year: 2019,
  mileage: 60000,
  fuel_type: "Gasoline",
  transmission: "Automatic",
  condition: "Good",
  owners: 1,
  accident_history: false,
};
const price = (input: PredictionInput) => predictPrice(artifact, input).estimated_price;

describe("saved model artifact", () => {
  it("has the expected structure", () => {
    expect(artifact.formatVersion).toBe(1);
    expect(MODEL_NAMES).toContain(artifact.bestModel);
    expect(artifact.catalog.length).toBeGreaterThan(10);
  });

  it("returns a plausible estimate with a range that contains it", () => {
    const result = predictPrice(artifact, camry);
    expect(result.estimated_price).toBeGreaterThan(5000);
    expect(result.estimated_price).toBeLessThan(40000);
    expect(result.price_range.low).toBeLessThanOrEqual(result.estimated_price);
    expect(result.price_range.high).toBeGreaterThanOrEqual(result.estimated_price);
    expect(result.model_used).toBe(artifact.bestModel);
    expect(Object.keys(result.model_predictions)).toEqual([...MODEL_NAMES]);
  });

  it("values newer cars above older ones", () => {
    expect(price({ ...camry, year: 2023, mileage: 20000 })).toBeGreaterThan(price({ ...camry, year: 2012, mileage: 130000 }));
  });

  it("lowers the price for higher mileage", () => {
    expect(price({ ...camry, mileage: 20000 })).toBeGreaterThan(price({ ...camry, mileage: 180000 }));
  });

  it("penalises accidents and poor condition", () => {
    expect(price(camry)).toBeGreaterThan(price({ ...camry, condition: "Poor", accident_history: true, owners: 4 }));
  });

  it("prices luxury vehicles above economy cars of the same age", () => {
    const common = { year: 2020, mileage: 50000 };
    expect(price({ manufacturer: "BMW", model: "X5", ...common })).toBeGreaterThan(price({ manufacturer: "Kia", model: "Forte", ...common }));
  });

  it("accepts messy casing and synonyms", () => {
    expect(price({ ...camry, manufacturer: " toyota ", model: "CAMRY", fuel_type: "gas", transmission: "auto" })).toBe(price(camry));
  });

  it("imputes optional fields and reports them", () => {
    const result = predictPrice(artifact, { manufacturer: "Toyota", model: "Camry", year: 2019, mileage: 60000 });
    expect(result.imputed_fields).toEqual(
      expect.arrayContaining(["fuel_type", "transmission", "body_type", "drivetrain", "engine_size", "condition", "owners", "accident_history"]),
    );
  });

  it("warns about vehicles unseen in training", () => {
    const result = predictPrice(artifact, { manufacturer: "Toyota", model: "Supra Mk4", year: 2015, mileage: 80000 });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.estimated_price).toBeGreaterThan(0);
  });

  it("forecasts a non-increasing value over the next five years", () => {
    const forecast = predictPrice(artifact, camry).depreciation_forecast;
    expect(forecast).toHaveLength(6);
    for (let i = 1; i < forecast.length; i++) {
      expect(forecast[i].estimated_price).toBeLessThanOrEqual(forecast[i - 1].estimated_price);
      expect(forecast[i].mileage).toBeGreaterThan(forecast[i - 1].mileage);
    }
  });
});

describe("model matching", () => {
  const model = (make: string, text: string) => {
    const id = resolveVehicleIdentity(artifact, make, text);
    return id.knownModel ? id.model : null;
  };

  it("ignores trims and spacing", () => {
    expect(model("Honda", "Civic EX")).toBe("Civic");
    expect(model("Ford", "f150 xlt")).toBe("F-150");
    expect(model("Honda", "cr v")).toBe("CR-V");
    expect(model("Mazda", "mazda 3 touring")).toBe("Mazda3");
    expect(model("Ford", "Mustang Mach-E GT")).toBe("Mustang Mach-E");
    expect(model("Jeep", "grand cherokee limited")).toBe("Grand Cherokee");
  });

  it("expands a short name when only one model fits", () => {
    expect(model("chevy", "silverado")).toBe("Silverado 1500");
    expect(model("Chevrolet", "Silverado 4x4")).toBe("Silverado 1500");
    expect(model("Mazda", "miata")).toBe("MX-5 Miata");
  });

  it("stays unknown when the text is ambiguous or unrelated", () => {
    expect(model("Tesla", "model")).toBeNull();
    expect(model("BMW", "m340i")).toBeNull();
    expect(model("Toyota", "Supra Mk4")).toBeNull();
    expect(findModel([{ name: "A3" }], "")).toBeUndefined();
  });
});

describe("mileage", () => {
  it("never makes a car worth more", () => {
    for (const car of [camry, { ...camry, manufacturer: "Ford", model: "F-150", year: 2014 }]) {
      let previous = Infinity;
      for (let mileage = 0; mileage <= 200_000; mileage += 1_000) {
        const p = price({ ...car, mileage });
        expect(p).toBeLessThanOrEqual(previous);
        previous = p;
      }
    }
  });
});

describe("condition", () => {
  it("never makes a better car worth less", () => {
    const porsche: PredictionInput = { manufacturer: "Porsche", model: "911", year: 2012, mileage: 54000, transmission: "Manual" };
    for (const car of [camry, porsche]) {
      const prices = ["Excellent", "Good", "Fair", "Poor"].map((condition) => price({ ...car, condition }));
      for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    }
  });
});

describe("inputs that contradict the training data", () => {
  const warningsFor = (input: PredictionInput) => predictPrice(artifact, input).warnings.join(" | ");

  it("flags fuel, transmission and an engine on an electric-only model", () => {
    const w = warningsFor({ manufacturer: "Tesla", model: "Model 3", year: 2022, mileage: 28000, fuel_type: "Gasoline", transmission: "Manual", engine_size: 5 });
    expect(w).toMatch(/fuel type "Gasoline"/);
    expect(w).toMatch(/transmission "Manual"/);
    expect(w).toMatch(/with an engine/);
  });

  it("flags a year outside the model's range", () => {
    expect(warningsFor({ manufacturer: "Tesla", model: "Model 3", year: 2004, mileage: 100000, fuel_type: "Electric" })).toMatch(/only seen from 2018/);
  });

  it("flags body, drivetrain and engine size the model never had", () => {
    const w = warningsFor({ manufacturer: "Honda", model: "Civic", year: 2018, mileage: 60000, body_type: "Truck", drivetrain: "4WD", engine_size: 6.2 });
    expect(w).toMatch(/body type "Truck"/);
    expect(w).toMatch(/drivetrain "4WD"/);
    expect(w).toMatch(/6.2 L engine/);
  });

  it("flags implausible miles for the car's age", () => {
    expect(warningsFor({ ...camry, year: 2025, mileage: 300000 })).toMatch(/miles a year/);
  });

  it("stays quiet for every valid catalogue combination", () => {
    for (const make of artifact.catalog) {
      for (const m of make.models) {
        const year = Math.round((m.years[0] + m.years[1]) / 2);
        const fuel = m.fuelTypes[0];
        const w = predictPrice(artifact, {
          manufacturer: make.name, model: m.name, year, mileage: Math.max(0, 2026 - year) * 12000,
          fuel_type: fuel, transmission: m.transmissions[0], body_type: m.bodyTypes[0], drivetrain: m.drivetrains[0],
          engine_size: fuel === "Electric" ? null : m.engineSizes[0] ?? null,
        }).warnings;
        expect(w).toEqual([]);
      }
    }
  });
});

describe("forecast", () => {
  it("reports the real age, even past the model's internal cap", () => {
    const f = predictPrice(artifact, { ...camry, manufacturer: "Honda", model: "Civic", year: 1980, mileage: 150000 }).depreciation_forecast;
    expect(f[0].vehicle_age).toBe(46);
    expect(f[1].vehicle_age).toBe(47);
  });
});
