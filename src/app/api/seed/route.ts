import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { graphStats, seedGraph } from "@/lib/graph/seed";


/**
 * POST /api/seed?tenant=demo — (re)build the synthetic company graph for a
 * tenant. Idempotent; wipes only that tenant's graph (multigraph isolation).
 * The UI exposes this as "Re-seed demo graph".
 */
export async function POST(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json({ error: "FalkorDB not configured." }, { status: 503 });
  }
  const tenant = req.nextUrl.searchParams.get("tenant") ?? "demo";
  try {
    const graph = await selectGraph(tenant);
    const seeded = await seedGraph(graph, tenant);
    const stats = await graphStats(graph);
    return NextResponse.json({ ok: true, ...seeded, stats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET /api/seed?tenant=demo — stats only (does not reseed). */
export async function GET(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json({ error: "FalkorDB not configured." }, { status: 503 });
  }
  const tenant = req.nextUrl.searchParams.get("tenant") ?? "demo";
  try {
    const graph = await selectGraph(tenant);
    const stats = await graphStats(graph);
    return NextResponse.json({ tenant, ...stats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
