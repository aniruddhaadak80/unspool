import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/orchestrator";
import { isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { graphStats } from "@/lib/graph/seed";

export const maxDuration = 60;

/**
 * POST /api/agent — run one reasoning turn.
 *
 * Every request carries a tenantId. That tenant maps to its OWN FalkorDB graph
 * (multigraph topology: one instance, thousands of isolated graphs), so each
 * user/agent/operator gets separate memory and state with no separate
 * deployment. This is the "separate memory per user or tenant" requirement.
 */
export async function POST(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json(
      {
        error: "FalkorDB is not configured.",
        hint: "Set FALKORDB_URL (or FALKORDB_HOST/PORT/PASSWORD) in .env.local or Vercel env vars.",
      },
      { status: 503 },
    );
  }

  let body: { question?: string; tenantId?: string; focus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "Missing `question`." }, { status: 400 });
  }
  const tenantId = (body.tenantId ?? "demo").trim() || "demo";

  try {
    const result = await runAgent({ tenantId, question, focus: body.focus });
    const stats = await graphStats(await selectGraph(tenantId));
    return NextResponse.json({ ...result, graphStats: stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
