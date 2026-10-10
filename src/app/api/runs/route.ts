import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { getRunTrace } from "@/lib/agent/trace";
import { memories } from "@/lib/graph/queries";


/**
 * GET /api/runs?tenant=demo[&runId=...] — full trace for one run, or recent
 * runs + memories. Everything here is read straight out of FalkorDB: the
 * replay, the memory panels and the action log are all graph queries.
 */
export async function GET(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json({ error: "FalkorDB not configured." }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  const tenant = sp.get("tenant") ?? "demo";
  const runId = sp.get("runId");

  try {
    const graph = await selectGraph(tenant);
    if (runId) {
      const trace = await getRunTrace(graph, runId);
      if (!trace) return NextResponse.json({ error: "Run not found." }, { status: 404 });
      return NextResponse.json({ runId, ...trace });
    }
    const [episodic, semantic, procedural] = await Promise.all([
      memories(graph, "episodic"),
      memories(graph, "semantic"),
      memories(graph, "procedural"),
    ]);
    return NextResponse.json({ episodic, semantic, procedural });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
