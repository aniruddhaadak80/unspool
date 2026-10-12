"use client";

import { useState } from "react";

/**
 * Read-only Cypher console. Judges can paste the queries from the README and
 * run them live against the tenant graph; write clauses are rejected by the
 * server, so the graph can't be damaged from here.
 */

const EXAMPLES = [
  {
    label: "blast radius",
    cypher:
      "MATCH p = (s:Service {name:'checkout-api'})-[:DEPENDS_ON*1..3]->(dep:Service) RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth ORDER BY depth LIMIT 20",
  },
  {
    label: "pagerank",
    cypher:
      "CALL algo.pageRank('Service','DEPENDS_ON') YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 10",
  },
  {
    label: "who owns & covers this",
    cypher:
      "MATCH (s:Service {name:'risk-engine'}) OPTIONAL MATCH (s)-[:OWNED_BY]->(t:Team) OPTIONAL MATCH (p:Person)-[:ONCALL_FOR]->(s) RETURN s.name AS service, t.name AS team, collect(DISTINCT p.name) AS oncall",
  },
];

interface Result {
  ok?: boolean;
  columns?: string[];
  rows?: unknown[];
  stats?: Record<string, number>;
  ms?: number;
  truncated?: boolean;
  error?: string;
  hint?: string;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (Array.isArray(v)) return v.map(cell).join(", ");
  if (typeof v === "object") {
    const r = v as Record<string, unknown>;
    const label = r.label ?? r.name ?? r.title ?? r.id ?? r.key;
    if (label !== undefined) return String(label);
    return JSON.stringify(v).slice(0, 120);
  }
  return String(v).slice(0, 120);
}

export default function CypherConsole({ tenant }: { tenant: string }) {
  const [cypher, setCypher] = useState(EXAMPLES[0].cypher);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (query = cypher) => {
    setBusy(true);
    try {
      const res = await fetch("/api/cypher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, cypher: query }),
      });
      const data = (await res.json()) as Result;
      setResult(res.ok ? data : { ...data, error: data.error ?? `HTTP ${res.status}` });
    } catch (err) {
      setResult({ error: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  };

  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex shrink-0 items-start gap-2">
        <textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          spellCheck={false}
          rows={3}
          className="min-w-0 flex-1 resize-y rounded border font-mono text-[11.5px] leading-snug"
          style={{ background: "var(--panel-2)", borderColor: "var(--border-strong)" }}
          placeholder="MATCH (n) RETURN n LIMIT 10"
        />
        <button
          onClick={() => run()}
          disabled={busy || !cypher.trim()}
          className="micro shrink-0 rounded border px-2.5 py-1.5 transition-colors disabled:opacity-40"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {busy ? "running…" : "run"}
        </button>
      </div>

      <div className="mt-1.5 flex shrink-0 flex-wrap gap-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => {
              setCypher(ex.cypher);
              run(ex.cypher);
            }}
            className="micro rounded border px-1.5 py-0.5 transition-colors"
            style={{ borderColor: "var(--border-strong)", color: "var(--faint)" }}
          >
            {ex.label}
          </button>
        ))}
        <span className="micro self-center text-faint">read-only · writes rejected</span>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-auto">
        {result?.error && (
          <div className="micro mb-2" style={{ color: "var(--bad)" }}>
            {result.error}
            {result.hint ? ` — ${result.hint}` : ""}
          </div>
        )}
        {result?.ok && !result.error && rows.length === 0 && (
          <div className="micro text-faint">0 rows · {result.ms}ms</div>
        )}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    className="border-b px-1.5 py-1 text-left font-medium text-muted"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r, ri) => (
                <tr key={ri} className="align-top">
                  {cols.map((c) => (
                    <td key={c} className="border-b px-1.5 py-1 font-mono text-foreground" style={{ borderColor: "var(--border)" }}>
                      {cell((r as Record<string, unknown>)[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result?.ok && rows.length > 0 && (
          <div className="micro mt-1 text-faint">
            {rows.length} row{rows.length === 1 ? "" : "s"} · {result.ms}ms
            {result.truncated ? " · truncated" : ""}
            {result.stats && Object.keys(result.stats).length > 0
              ? ` · ${Object.entries(result.stats).map(([k, v]) => `${k}: ${v}`).join(" · ")}`
              : ""}
          </div>
        )}
        {!result && <div className="micro text-faint">pick an example or paste a MATCH / CALL algo.* query.</div>}
      </div>
    </div>
  );
}