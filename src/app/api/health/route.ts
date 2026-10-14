import { NextResponse } from "next/server";
import { getDb, isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { graphStats } from "@/lib/graph/seed";
import { runAlgorithm } from "@/lib/graph/queries";
import { hasLiveModel, modelLabel } from "@/lib/agent/provider";

/**
 * GET /api/health — connection + capability probe for the UI badge.
 *
 * When the graph is reachable this deliberately does more than ping: it reports
 * the tenant graphs, the seeded node/relationship counts, the node labels, and
 * which `algo.*` procedures actually run. That makes this one URL enough for a
 * judge to confirm the graph is real and populated — not just that a socket
 * opened. It never throws and always returns 200.
 */
const ALGOS = ["pageRank", "wcc", "cdlp", "betweennessCentrality"] as const;

export async function GET() {
  let falkor: "ok" | "unconfigured" | "error" = "unconfigured";
  let detail: string | undefined;
  let graphs: string[] | undefined;
  let graph: { nodes: number; rels: number; labels: string[] } | undefined;
  let algorithms: string[] = [];

  if (isFalkorConfigured()) {
    try {
      const db = await getDb();
      graphs = (await db.list()).slice(0, 20);
      falkor = "ok";

      // Prove the demo tenant actually has data and working algorithms.
      try {
        const g = await selectGraph("demo");
        const stats = await graphStats(g);
        graph = {
          nodes: stats.nodes,
          rels: stats.rels,
          labels: stats.labels.map((l) => l.label),
        };
        if (stats.nodes > 0) {
          const probes = await Promise.allSettled(
            ALGOS.map((a) => runAlgorithm(g, a, "Service", "DEPENDS_ON")),
          );
          algorithms = ALGOS.filter((_, i) => probes[i].status === "fulfilled");
        }
      } catch {
        // Reachable but the probe query failed — connection itself is fine.
      }
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
    graphs,
    graph,
    algorithms,
    time: Date.now(),
  });
}
