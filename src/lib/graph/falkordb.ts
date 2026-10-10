import { FalkorDB, type Graph } from "falkordb";

/**
 * A single, lazily-established FalkorDB connection shared across the serverless
 * process. FalkorDB speaks the Redis protocol (RESP); the official `falkordb`
 * Node client handles it. We keep one connection and reuse it per warm lambda.
 */
let dbPromise: Promise<FalkorDB> | null = null;

export function connectionConfig() {
  const url = process.env.FALKORDB_URL; // e.g. falkor://default:XXXX@host:6379
  const host = process.env.FALKORDB_HOST;
  const port = Number(process.env.FALKORDB_PORT ?? 6379);
  const username = process.env.FALKORDB_USERNAME;
  const password = process.env.FALKORDB_PASSWORD;
  const tls = process.env.FALKORDB_TLS === "true";
  return { url, host, port, username, password, tls };
}

/**
 * Placeholders from `.env.example` must NOT count as "configured" — otherwise
 * the API surface throws `ENOTFOUND YOUR_HOST` (500) instead of degrading to
 * the documented 503 + setup hint. Treat template values as unconfigured.
 */
const PLACEHOLDER = /your[_-]?(host|password)|sk-or-\.\.\.|^your-password$/i;

function looksReal(value: string | undefined): boolean {
  return Boolean(value && !PLACEHOLDER.test(value));
}

export function isFalkorConfigured(): boolean {
  const { url, host } = connectionConfig();
  if (url) {
    if (!looksReal(url)) return false;
    // A URL with an unresolvable/templated host is as good as unconfigured.
    const hostPart = url.split("@").pop()?.split("/")[0] ?? "";
    return looksReal(hostPart);
  }
  if (!looksReal(host)) return false;
  return true;
}

async function connect(): Promise<FalkorDB> {
  const { url, host, port, username, password, tls } = connectionConfig();
  if (url) {
    return FalkorDB.connect({ url, socket: { tls } });
  }
  return FalkorDB.connect({
    host: host ?? "localhost",
    port,
    username,
    password,
    socket: { tls },
  });
}

export function getDb(): Promise<FalkorDB> {
  if (!dbPromise) {
    dbPromise = connect().catch((err) => {
      dbPromise = null; // allow retry on next request
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Multigraph topology: every tenant (here: a demo org / an operator) gets its
 * own isolated graph in the same FalkorDB instance — no separate deployments.
 */
export function graphNameFor(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `unspool_${safe}`;
}

export async function selectGraph(tenantId: string): Promise<Graph> {
  const db = await getDb();
  return db.selectGraph(graphNameFor(tenantId));
}

/** Typed convenience wrapper around GRAPH.QUERY returning row objects. */
export async function runCypher<T = Record<string, unknown>>(
  graph: Graph,
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<{ rows: T[]; stats: Record<string, number>; raw: unknown }> {
  const res = await graph.query<Record<string, unknown>>(cypher, {
    params: params as Record<string, string | number | boolean | null>,
  });
  const rows = (res.data ?? []) as unknown as T[];
  const stats = extractStats(res.metadata ?? []);
  return { rows, stats, raw: res };
}

/**
 * FalkorDB reports stats like "Nodes created: 3" as an array of strings in the
 * result metadata. Parse them into a record so the trace UI can surface them.
 */
function extractStats(metadata: unknown[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const entry of metadata) {
    if (typeof entry !== "string") continue;
    const m = entry.match(/^(.*?):\s*(-?\d+(?:\.\d+)?)$/);
    if (m) stats[m[1].trim().toLowerCase()] = Number(m[2]);
  }
  return stats;
}
