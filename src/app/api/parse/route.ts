import { z } from "zod";
import { getModelArtifact } from "@/lib/model-store";
import { callGemini, MAX_LISTING_CHARS, normalizeListing, ParseError } from "@/lib/parse-listing";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { formatZodError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// every call spends gemini quota: cap each client, and the instance as a whole
const perClient = createRateLimiter({ limit: 8, windowMs: 60_000 });
const perInstance = createRateLimiter({ limit: 60, windowMs: 60_000 });

function tooMany(retryAfter: number) {
  return Response.json(
    { error: `Too many requests, try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

const bodySchema = z.object({ text: z.string().trim().min(5, "describe the car in a few words").max(MAX_LISTING_CHARS) });

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Plain-English input is not configured on this server" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: formatZodError(parsed.error) }, { status: 422 });
  }

  const client = perClient(clientIp(request));
  if (!client.ok) return tooMany(client.retryAfter);
  const instance = perInstance("all");
  if (!instance.ok) return tooMany(instance.retryAfter);

  try {
    const raw = await callGemini(parsed.data.text, { apiKey, model: process.env.GEMINI_MODEL });
    return Response.json(normalizeListing(raw, getModelArtifact(), parsed.data.text));
  } catch (error) {
    if (error instanceof ParseError) return Response.json({ error: error.message }, { status: error.status });
    console.error("[parse] unexpected error", error);
    return Response.json({ error: "Could not read the description" }, { status: 502 });
  }
}
