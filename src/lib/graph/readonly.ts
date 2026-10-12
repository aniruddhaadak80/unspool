/**
 * Read-only enforcement for the Cypher console.
 *
 * The console is a showcase, not an administration surface: it must never be
 * able to mutate a graph (or reach outside its sandbox). Rather than trusting
 * the client, we refuse anything that looks like a write before it reaches
 * FalkorDB. This is deliberately conservative — a false refusal is a UX
 * annoyance, a false allow could drop a demo graph minutes before judging.
 */

/** Clauses that mutate state, plus GRAPH.* (cross-graph) and FOREACH. */
const WRITE_CLAUSE =
  /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|DETACH|ALTER|FOREACH|GRAPH\.)\b/i;

/** Split a Cypher string into non-empty statements. */
export function statements(cypher: string): string[] {
  return cypher
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The console runs exactly one statement per request. */
export function isSingleStatement(cypher: string): boolean {
  return statements(cypher).length <= 1;
}

/** Drop Cypher comments so a keyword inside a comment can't skew the verdict. */
export function stripComments(cypher: string): string {
  return cypher.replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Drop string literals before keyword matching. A write clause can never be
 * smuggled inside a string (Cypher doesn't execute string contents), so this
 * is safe — and it stops `WHERE n.name CONTAINS 'create'` from being rejected.
 */
export function stripStringLiterals(cypher: string): string {
  return cypher.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** True when the query tries to write. */
export function containsWriteClause(cypher: string): boolean {
  return WRITE_CLAUSE.test(stripStringLiterals(stripComments(cypher)));
}

/** The full gate: one statement, and not a write. */
export function isReadOnlyCypher(cypher: string): boolean {
  return isSingleStatement(cypher) && !containsWriteClause(cypher);
}

/** Execute-ready form: a single trailing `;` is harmless, so trim it. */
export function toExecutable(cypher: string): string {
  return cypher.replace(/;\s*$/, "").trim();
}
