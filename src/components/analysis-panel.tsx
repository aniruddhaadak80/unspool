"use client";

import { useEffect, useState } from "react";

/**
 * Structural X-ray of the tenant graph: PageRank (critical services), WCC
 * (failure islands) and betweenness (bridge services), straight from
 * FalkorDB's algo.* procedures — the same algorithms the agent uses as tools.
 */

interface Ranked {
  node: { label: string } | null;
  score: number | null;
}
interface ClusterRow {
  id: string;
  count: number;
  names: string[];
}
interface AnalysisResult {
  meta?: { nodes: number; rels: number };
  algorithms?: {
    pageRank?: { ok: boolean; error?: string | null; top?: Ranked[] };
    wcc?: { ok: boolean; error?: string | null; clusters?: ClusterRow[] };
    betweenness?: { ok: boolean; error?: string | null; top?: Ranked[] };
  };
}

function Bar({ score }: { score: number | null }) {
  if (score === null) return null;
  const width = Math.min(100, Math.max(4, Math.round(score * 10000) / 20));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: "var(--accent)" }} />
    </div>
  );
}

export default function AnalysisPanel({ tenant }: { tenant: string }) {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/analysis?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tenant]);

  if (loading) return <div className="micro p-3 text-faint">running algorithms…</div>;
  if (error || !data)
    return (
      <div className="micro p-3 text-faint">
        {error === "HTTP 503"
          ? "graph offline — analysis needs a live FalkorDB connection."
          : `analysis unavailable (${error ?? "no data"})`}
      </div>
    );

  const pr = data.algorithms?.pageRank;
  const wcc = data.algorithms?.wcc;
  const btw = data.algorithms?.betweenness;
  const top = pr?.top?.slice(0, 6) ?? [];
  const clusters = wcc?.clusters ?? [];
  const bridges = btw?.top?.slice(0, 6) ?? [];

  return (
    <div className="grid h-full grid-cols-3 gap-3 overflow-y-auto p-3">
      <div className="min-w-0">
        <div className="micro" style={{ color: "var(--accent)" }}>
          critically load-bearing <span className="text-faint">· algo.pageRank</span>
        </div>
        {pr?.ok === false && <div className="micro mt-1 text-faint">algo failed: {pr.error}</div>}
        <div className="mt-1.5 space-y-1.5">
          {top.map((t) => (
            <div key={t.node?.label ?? "?"} className="min-w-0">
              <div className="truncate text-[11.5px] text-foreground">{t.node?.label ?? "?"}</div>
              <Bar score={t.score} />
            </div>
          ))}
          {top.length === 0 && pr?.ok && <div className="micro text-faint">no services found</div>}
        </div>
      </div>

      <div className="min-w-0">
        <div className="micro" style={{ color: "var(--accent)" }}>
          failure islands <span className="text-faint">· algo.WCC</span>
        </div>
        {wcc?.ok === false && <div className="micro mt-1 text-faint">algo failed: {wcc.error}</div>}
        <div className="mt-1.5 space-y-1.5">
          {clusters
            .filter((c) => c.count > 1)
            .slice(0, 5)
            .map((c) => (
              <div key={c.id} className="min-w-0">
                <div className="micro text-faint">
                  {c.count} services {c.id === "0" ? "· main graph" : ""}
                </div>
                <div className="truncate text-[11.5px] text-foreground">{c.names.join(", ")}</div>
              </div>
            ))}
          {clusters.length === 0 && wcc?.ok && <div className="micro text-faint">single component</div>}
        </div>
      </div>

      <div className="min-w-0">
        <div className="micro" style={{ color: "var(--accent)" }}>
          bridge services <span className="text-faint">· betweenness</span>
        </div>
        {btw?.ok === false && <div className="micro mt-1 text-faint">algo failed: {btw.error}</div>}
        <div className="mt-1.5 space-y-1.5">
          {bridges.map((t) => (
            <div key={t.node?.label ?? "?"} className="min-w-0">
              <div className="truncate text-[11.5px] text-foreground">{t.node?.label ?? "?"}</div>
              <Bar score={t.score} />
            </div>
          ))}
          {bridges.length === 0 && btw?.ok && <div className="micro text-faint">no bridges found</div>}
        </div>
      </div>
    </div>
  );
}