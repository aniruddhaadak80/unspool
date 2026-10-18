import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, normalizeTenantId, runCypher, selectGraph } from "@/lib/graph/falkordb";
import { normalizeNode, type GraphNode } from "@/lib/graph/schema";
import { buildAlgorithmCall } from "@/lib/graph/queries";
import { graphStats } from "@/lib/graph/seed";

export const maxDuration = 30;

/**
 * GET /api/analysis?tenant=… — the "structural X-ray" of a tenant graph.
 *
 * Runs PageRank (most critical services), WCC (failure islands), CDLP
 * (deployment communities) and betweenness centrality (bridge services) over
 * Service/DEPENDS_ON, plus basic graph stats. Each algorithm is allowed to
 * fail on its own without killing the others, so the UI can degrade.
 */
export async function GET(req: NextRequest) {
  if (!isFalkorConfigured()) {
    return NextResponse.json(
      { error: "FalkorDB not configured.", hint: "Set FALKORDB_URL." },
      { status: 503 },
    );
  }
  const tenant = normalizeTenantId(req.nextUrl.searchParams.get("tenant"));

  try {
    const graph = await selectGraph(tenant);
    const meta = await graphStats(graph);

    const run = async (algo: Parameters<typeof buildAlgorithmCall>[0]) => {
      try {
        const { rows } = await runCypher<{
          node: unknown;
          score?: number;
          componentId?: number | string;
          communityId?: number | string;
        }>(graph, buildAlgorithmCall(algo, "Service", "DEPENDS_ON"));
        return { ok: true as const, rows };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          rows: [],
        };
      }
    };

    const [pagerank, wcc, cdlp, betweenness] = await Promise.all([
      run("pageRank"),
      run("wcc"),
      run("cdlp"),
      run("betweennessCentrality"),
    ]);

    const ranked = (r: (typeof pagerank.rows)[number]) => ({
      node: normalizeNode(r.node) as GraphNode | null,
      score: typeof r.score === "number" ? Math.round(r.score * 1000) / 1000 : null,
      cluster: r.componentId !== undefined ? String(r.componentId) : null,
      community: r.communityId ?? null,
    });

    const byCluster = new Map<string, { names: string[]; count: number }>();
    for (const r of wcc.rows) {
      const n = normalizeNode(r.node);
      const key = String(r.componentId ?? "?");
      const entry = byCluster.get(key) ?? { names: [], count: 0 };
      if (n) entry.names.push(n.label);
      entry.count += 1;
      byCluster.set(key, entry);
    }

    const communities = new Map<number | string, string[]>();
    for (const r of cdlp.rows) {
      const n = normalizeNode(r.node);
      if (!n || r.communityId === null || r.communityId === undefined) continue;
      communities.set(r.communityId, [...(communities.get(r.communityId) ?? []), n.label]);
    }

    return NextResponse.json({
      ok: true,
      tenant,
      meta,
      algorithms: {
        pageRank: { ok: pagerank.ok, error: pagerank.ok ? null : pagerank.error, top: pagerank.rows.slice(0, 10).map(ranked) },
        wcc: {
          ok: wcc.ok,
          error: wcc.ok ? null : wcc.error,
          clusters: [...byCluster.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([id, c]) => ({ id, count: c.count, names: c.names.slice(0, 8) })),
        },
        cdlp: {
          ok: cdlp.ok,
          error: cdlp.ok ? null : cdlp.error,
          communities: [...communities.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 10)
            .map(([id, names]) => ({ id, count: names.length, names })),
        },
        betweenness: {
          ok: betweenness.ok,
          error: betweenness.ok ? null : betweenness.error,
          top: betweenness.rows.slice(0, 8).map(ranked),
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}