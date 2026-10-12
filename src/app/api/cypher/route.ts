import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, runCypher, selectGraph } from "@/lib/graph/falkordb";
import { isReadOnlyCypher, isSingleStatement, toExecutable } from "@/lib/graph/readonly";

export const maxDuration = 30;

/**
 * POST /api/cypher — read-only Cypher console.
 *
 * Lets judges (and the UI) run the README's Cypher queries live against the
 * tenant graph. Read-only by construction: write clauses and multi-statement
 * scripts are rejected before they reach FalkorDB, and the returned rows are
 * sanitized for JSON (BigInt ids → strings).
 */

// Cap rows/columns so a `MATCH (n) RETURN n` over the whole graph stays snappy.
const MAX_ROWS = 200;
const MAX_COLS = 12;

/** Deep-sanitize a query result so JSON.stringify can't throw (BigInt etc.). */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "bigint") return value.toString();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    // Client-parsed graph entities become readable objects.
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = sanitize(v, depth + 1);
    return out;
  }
  return value;
}

export async function POST(req: NextRequest) {
  let body: { tenantId?: string; cypher?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body.cypher ?? "").trim();
  if (!raw) return NextResponse.json({ error: "Missing `cypher`." }, { status: 400 });
  const tenantId = (body.tenantId ?? "demo").trim() || "demo";

  if (!isSingleStatement(raw)) {
    return NextResponse.json(
      { error: "One statement per run.", hint: "Remove the extra `;`-separated statements." },
      { status: 400 },
    );
  }
  const cypher = toExecutable(raw);
  if (!isReadOnlyCypher(raw)) {
    return NextResponse.json(
      {
        error: "Read-only console: this query mutates the graph.",
        allowed: "MATCH / CALL algo.* / RETURN — use the agent's actions for writes.",
      },
      { status: 403 },
    );
  }

  if (!isFalkorConfigured()) {
    return NextResponse.json(
      { error: "FalkorDB not configured.", hint: "Set FALKORDB_URL." },
      { status: 503 },
    );
  }

  const started = performance.now();
  try {
    const graph = await selectGraph(tenantId);
    const { rows, stats, raw: res } = await runCypher<Record<string, unknown>>(graph, cypher);
    const capped = rows.slice(0, MAX_ROWS);
    const columns = Array.from(
      new Set(capped.flatMap((r) => Object.keys(r)).slice(0, MAX_COLS)),
    );
    return NextResponse.json({
      ok: true,
      tenant: tenantId,
      cypher,
      columns,
      rows: capped.map((r) => sanitize(r)),
      stats,
      truncated: rows.length > MAX_ROWS,
      ms: Math.round(performance.now() - started),
      rawCount: (res as { data?: unknown[] }).data?.length ?? rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}