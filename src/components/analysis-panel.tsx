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

/**
 * A response carries the tenant it belongs to, so a response for a tenant that
 * is no longer being rendered is simply not "current" — which lets the loading
 * state be derived during render. No `setLoading`/`setError` reset inside the
 * effect: that synchronous reset is what `react-hooks/set-state-in-effect`
 * flags, and it causes the cascading render the rule exists to prevent.
 * https://react.dev/learn/you-might-not-need-an-effect
 */
type TenantResult =
  | { tenant: string; ok: true; data: AnalysisResult }
  | { tenant: string; ok: false; error: string };

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
  const [result, setResult] = useState<TenantResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/analysis?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: AnalysisResult) => {
        if (alive) setResult({ tenant, ok: true, data });
      })
      .catch((e) => {
        if (alive) setResult({ tenant, ok: false, error: String(e.message ?? e) });
      });
    return () => {
      alive = false;
    };
  }, [tenant]);

  // Only a response for the tenant being rendered counts; a tenant switch
  // falls back to "running" without any state reset.
  const current = result?.tenant === tenant ? result : null;

  if (!current) return <div className="micro p-3 text-faint">running algorithms…</div>;
  if (!current.ok)
    return (
      <div className="micro p-3 text-faint">
        {current.error === "HTTP 503"
          ? "graph offline — analysis needs a live FalkorDB connection."
          : `analysis unavailable (${current.error})`}
      </div>
    );

  const data = current.data;

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