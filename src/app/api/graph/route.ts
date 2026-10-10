import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { subgraphAround } from "@/lib/graph/queries";


/** GET /api/graph?tenant=demo&seed=checkout-api&hops=2 — canvas data. */
export async function GET(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json({ error: "FalkorDB not configured." }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  const tenant = sp.get("tenant") ?? "demo";
  const seed = sp.get("seed") ?? "checkout-api";
  const hops = Number(sp.get("hops") ?? 2);

  try {
    const graph = await selectGraph(tenant);
    const sub = await subgraphAround(graph, seed, Math.min(3, Math.max(1, hops)));
    return NextResponse.json({ seed, hops, ...sub });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
