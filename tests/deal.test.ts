import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDeal } from "@/lib/deal-check";
import type { ModelArtifact } from "@/ml/artifact";
import { explainPrice, rateDeal } from "@/ml/deal";
import type { PredictionInput } from "@/ml/predict";

const range = { low: 9000, high: 11500 };

describe("rateDeal", () => {
  it("rates below the 80 % range as a great deal", () => {
    const v = rateDeal(8500, 10000, range);
    expect(v.rating).toBe("great");
    expect(v.difference).toBe(-1500);
    expect(v.difference_pct).toBe(-15);
  });

  it("uses the percentage bands inside the range", () => {
    expect(rateDeal(9600, 10000, range).rating).toBe("good"); // -4 %
    expect(rateDeal(9700, 10000, range).rating).toBe("good"); // exactly -3 %
    expect(rateDeal(10000, 10000, range).rating).toBe("fair");
    expect(rateDeal(10500, 10000, range).rating).toBe("fair"); // exactly +5 %
    expect(rateDeal(11000, 10000, range).rating).toBe("high");
  });

  it("rates above the range as overpriced", () => {
    expect(rateDeal(12000, 10000, range).rating).toBe("overpriced");
  });

  it("flags prices far below the range as too good to be true", () => {
    expect(rateDeal(7000, 10000, range).too_good_to_be_true).toBe(true);
    expect(rateDeal(7000, 10000, range).summary).toMatch(/check the title/);
    expect(rateDeal(8500, 10000, range).too_good_to_be_true).toBe(false);
  });

  it("writes a plain summary", () => {
    expect(rateDeal(10000, 10000, range).summary).toBe("Asking price matches the estimated fair price of $10,000.");
    expect(rateDeal(11000, 10000, range).summary).toBe(
      "Asking price is $1,000 (10.0%) above the estimated fair price of $10,000.",
    );
  });

  it("rejects non-positive prices", () => {
    expect(() => rateDeal(0, 10000, range)).toThrow();
    expect(() => rateDeal(10000, 0, range)).toThrow();
  });
});

describe("explainPrice", () => {
  const ctx = { referenceYear: 2026, milesPerYear: 12000 };
  // fake model: every characteristic has a known dollar effect
  const fake = (v: PredictionInput) =>
    20000 -
    (v.mileage ?? 0) * 0.05 -
    (v.accident_history ? 1500 : 0) -
    ((v.owners ?? 1) - 1) * 300 +
    (v.condition === "Excellent" ? 800 : v.condition === "Fair" ? -900 : 0);

  it("measures each factor against a typical car", () => {
    const car: PredictionInput = { manufacturer: "Honda", model: "Civic", year: 2021, mileage: 90000, condition: "Fair", owners: 3, accident_history: true };
    const factors = explainPrice(car, fake, ctx);
    const byName = Object.fromEntries(factors.map((f) => [f.factor, f.impact]));
    // typical mileage for a 5 year old car is 60,000, so 30,000 extra miles cost 1,500
    expect(byName["mileage"]).toBe(-1500);
    expect(byName["accident history"]).toBe(-1500);
    expect(byName["condition"]).toBe(-900);
    expect(byName["previous owners"]).toBe(-600);
  });

  it("sorts by size of impact and drops tiny effects", () => {
    const car: PredictionInput = { manufacturer: "Honda", model: "Civic", year: 2021, mileage: 61000, condition: "Excellent" };
    const factors = explainPrice(car, fake, ctx);
    expect(factors.map((f) => f.factor)).toEqual(["condition"]); // mileage effect is only -50
    expect(factors[0].impact).toBe(800);
  });

  it("skips factors that are already typical", () => {
    const car: PredictionInput = { manufacturer: "Honda", model: "Civic", year: 2021, mileage: 60000, condition: "Good", owners: 1, accident_history: false };
    expect(explainPrice(car, fake, ctx)).toEqual([]);
  });
});

describe("checkDeal with the trained model", () => {
  const artifact = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "models", "car_price_model.json"), "utf8"),
  ) as ModelArtifact;
  const civic: PredictionInput = {
    manufacturer: "Honda", model: "Civic", year: 2018, mileage: 110000,
    fuel_type: "Gasoline", transmission: "Automatic", condition: "Fair", owners: 3, accident_history: true,
  };

  it("agrees with the price estimate and its range", () => {
    const { prediction, deal } = checkDeal(artifact, civic, 10000);
    expect(deal.fair_price).toBe(prediction.estimated_price);
    const low = checkDeal(artifact, civic, prediction.price_range.low - 100).deal.rating;
    const high = checkDeal(artifact, civic, prediction.price_range.high + 100).deal.rating;
    expect(low).toBe("great");
    expect(high).toBe("overpriced");
  });

  it("explains that accidents and poor condition lower the price", () => {
    const { factors } = checkDeal(artifact, civic, 10000);
    const accident = factors.find((f) => f.factor === "accident history");
    const condition = factors.find((f) => f.factor === "condition");
    expect(accident?.impact).toBeLessThan(0);
    expect(condition?.impact).toBeLessThan(0);
  });
});
