import type { ModelArtifact } from "@/ml/artifact";
import { explainPrice, rateDeal, type DealVerdict, type PriceFactor } from "@/ml/deal";
import { predictPrice, type PredictionInput, type PredictionResult } from "@/ml/predict";

export interface DealCheckResult {
  prediction: PredictionResult;
  deal: DealVerdict;
  factors: PriceFactor[];
}

/** prices the car, rates the asking price and explains the main price drivers */
export function checkDeal(artifact: ModelArtifact, input: PredictionInput, askingPrice: number): DealCheckResult {
  const prediction = predictPrice(artifact, input, { forecastYears: 0 });
  const deal = rateDeal(askingPrice, prediction.estimated_price, prediction.price_range);
  const factors = explainPrice(
    input,
    (v) => predictPrice(artifact, v, { forecastYears: 0 }).estimated_price,
    { referenceYear: artifact.referenceYear, milesPerYear: artifact.preprocessor.imputation.milesPerYear },
  );
  // keep the full forecast in the response, like /api/predict
  return { prediction: predictPrice(artifact, input), deal, factors };
}
