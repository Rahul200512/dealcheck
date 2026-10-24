/**
 * deal check: compares a listing's asking price with the model's fair-price estimate
 * and explains which characteristics push the price up or down.
 */
import type { PredictionInput } from "./predict";

export type DealRating = "great" | "good" | "fair" | "high" | "overpriced";

export interface DealVerdict {
  rating: DealRating;
  label: string;
  asking_price: number;
  fair_price: number;
  difference: number; // asking - fair, negative means below fair price
  difference_pct: number; // difference / fair, rounded to 0.1 %
  summary: string;
  too_good_to_be_true: boolean;
}

export interface PriceFactor {
  factor: string;
  description: string;
  impact: number; // dollars this characteristic adds (+) or removes (-) vs a typical car
}

const LABELS: Record<DealRating, string> = {
  great: "Great deal",
  good: "Good deal",
  fair: "Fair price",
  high: "Above market",
  overpriced: "Overpriced",
};

// thresholds relative to the fair price; the 80 % range bounds take priority at the edges
export const DEAL_THRESHOLDS = { good: -0.03, fair: 0.05 } as const;
// asking this far below the low end of the range is a warning sign, not just a bargain
const SUSPICIOUS_RATIO = 0.8;

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** rates an asking price against the estimate and its 80 % range */
export function rateDeal(asking: number, fair: number, range: { low: number; high: number }): DealVerdict {
  if (!(asking > 0) || !(fair > 0)) throw new Error("asking and fair price must be positive");
  const difference = Math.round(asking - fair);
  const pct = difference / fair;

  let rating: DealRating;
  if (asking < range.low) rating = "great";
  else if (asking > range.high) rating = "overpriced";
  else if (pct <= DEAL_THRESHOLDS.good) rating = "good";
  else if (pct <= DEAL_THRESHOLDS.fair) rating = "fair";
  else rating = "high";

  const too_good_to_be_true = asking < range.low * SUSPICIOUS_RATIO;
  const direction = difference < 0 ? "below" : "above";
  let summary =
    Math.abs(pct) < 0.005
      ? `Asking price matches the estimated fair price of ${usd(fair)}.`
      : `Asking price is ${usd(difference)} (${Math.abs(pct * 100).toFixed(1)} %) ${direction} the estimated fair price of ${usd(fair)}.`;
  if (too_good_to_be_true) {
    summary += " That is far below similar cars, so check the title, accident history and service records before buying.";
  }

  return {
    rating,
    label: LABELS[rating],
    asking_price: Math.round(asking),
    fair_price: Math.round(fair),
    difference,
    difference_pct: Math.round(pct * 1000) / 10,
    summary,
    too_good_to_be_true,
  };
}

interface Counterfactual {
  factor: string;
  applies: (v: PredictionInput) => boolean;
  typical: (v: PredictionInput, ctx: { referenceYear: number; milesPerYear: number }) => Partial<PredictionInput>;
  describe: (v: PredictionInput, ctx: { referenceYear: number; milesPerYear: number }) => string;
}

// each factor is swapped for a "typical" value; the price change is that factor's impact
const COUNTERFACTUALS: Counterfactual[] = [
  {
    factor: "mileage",
    applies: (v) => v.mileage != null,
    typical: (v, c) => ({ mileage: typicalMileage(v.year, c) }),
    describe: (v, c) =>
      `${Math.round(v.mileage ?? 0).toLocaleString("en-US")} miles vs about ${typicalMileage(v.year, c).toLocaleString("en-US")} typical for its age`,
  },
  {
    factor: "accident history",
    applies: (v) => v.accident_history === true,
    typical: () => ({ accident_history: false }),
    describe: () => "reported accident",
  },
  {
    factor: "condition",
    applies: (v) => v.condition != null && v.condition !== "Good",
    typical: () => ({ condition: "Good" }),
    describe: (v) => `${String(v.condition).toLowerCase()} condition vs good`,
  },
  {
    factor: "previous owners",
    applies: (v) => v.owners != null && v.owners !== 1,
    typical: () => ({ owners: 1 }),
    describe: (v) => `${v.owners} previous owners vs 1`,
  },
];

function typicalMileage(year: number, ctx: { referenceYear: number; milesPerYear: number }) {
  const age = Math.max(0, ctx.referenceYear - year);
  return Math.round((age === 0 ? 3000 : age * ctx.milesPerYear) / 1000) * 1000;
}

/**
 * explains the estimate by re-pricing the car with one characteristic set to a typical value.
 * estimate is injected so this stays a pure, testable function.
 */
export function explainPrice(
  input: PredictionInput,
  estimate: (v: PredictionInput) => number,
  ctx: { referenceYear: number; milesPerYear: number },
  minImpact = 100,
): PriceFactor[] {
  const base = estimate(input);
  const factors: PriceFactor[] = [];
  for (const cf of COUNTERFACTUALS) {
    if (!cf.applies(input)) continue;
    const typicalPrice = estimate({ ...input, ...cf.typical(input, ctx) });
    const impact = Math.round((base - typicalPrice) / 10) * 10;
    if (Math.abs(impact) >= minImpact) factors.push({ factor: cf.factor, description: cf.describe(input, ctx), impact });
  }
  return factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}
