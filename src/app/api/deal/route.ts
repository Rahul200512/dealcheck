import { checkDeal } from "@/lib/deal-check";
import { getModelArtifact } from "@/lib/model-store";
import { recordPredictions } from "@/lib/prediction-log";
import { dealInputSchema, formatZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = dealInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: formatZodError(parsed.error) }, { status: 422 });
  }

  const { asking_price, ...vehicle } = parsed.data;
  const result = checkDeal(getModelArtifact(), vehicle, asking_price);
  const source = request.headers.get("x-client") === "web" ? "web" : "api";
  await recordPredictions([{ source, input: vehicle, result: result.prediction }]);
  return Response.json(result);
}
