import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getModelArtifact } from "@/lib/model-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // database is optional, so only the model decides health
  let database: "ok" | "error" | "not_configured" = "not_configured";
  const db = getDb();
  if (db) {
    try {
      await db.execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "error";
    }
  }
  let model: { version: string; best_model: string } | null = null;
  try {
    const artifact = getModelArtifact();
    model = { version: artifact.version, best_model: artifact.bestModel };
  } catch {
    model = null;
  }
  const ok = model !== null && database !== "error";
  return Response.json({ ok, database, model }, { status: ok ? 200 : 500 });
}
