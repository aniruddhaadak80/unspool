import { NextResponse } from "next/server";
import { getDb, isFalkorConfigured } from "@/lib/graph/falkordb";
import { hasLiveModel, modelLabel } from "@/lib/agent/provider";


/** GET /api/health — connection + capability probe for the UI badge. */
export async function GET() {
  let falkor: "ok" | "unconfigured" | "error" = "unconfigured";
  let detail: string | undefined;
  if (isFalkorConfigured()) {
    try {
      const db = await getDb();
      await db.list();
      falkor = "ok";
    } catch (err) {
      falkor = "error";
      detail = err instanceof Error ? err.message : String(err);
    }
  }
  return NextResponse.json({
    falkordb: falkor,
    detail,
    agent: hasLiveModel() ? "live-llm" : "graph-replay",
    model: modelLabel(),
    time: Date.now(),
  });
}
