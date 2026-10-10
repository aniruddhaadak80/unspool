import type { Graph } from "falkordb";
import { runCypher } from "@/lib/graph/falkordb";
import type { MemoryKind } from "@/lib/graph/schema";

/**
 * Graph-native agent memory. All three memory types from the brief live in the
 * same FalkorDB graph, typed by `kind`, linked to the entities they are ABOUT.
 * Because memory is a node, not a vector blob, the agent queries it with the
 * same Cypher it uses for the rest of the world — and the UI can show exactly
 * which memory shaped a decision.
 */

export interface WriteMemoryInput {
  kind: MemoryKind;
  key: string;
  value: string;
  about?: string[];
  runId?: string;
}

export async function writeMemory(graph: Graph, input: WriteMemoryInput) {
  await runCypher(
    graph,
    `CREATE (m:Memory {kind:$kind, key:$key, value:$value, at:timestamp()})
     RETURN m.key AS key`,
    { kind: input.kind, key: input.key, value: input.value },
  );
  const about = input.about ?? [];
  if (about.length) {
    await runCypher(
      graph,
      `MATCH (m:Memory {key:$key, kind:$kind})
       UNWIND $about AS name
       MATCH (e {name:name})
       MERGE (m)-[:ABOUT]->(e)
       RETURN count(*) AS linked`,
      { key: input.key, kind: input.kind, about },
    );
  }
  return { ok: true, key: input.key };
}

/**
 * Recall across sessions. Episodic = what happened; semantic = what is true;
 * procedural = how to act. Ranked by recency, filterable by entity + keyword.
 */
export async function recall(
  graph: Graph,
  opts: { kind?: MemoryKind; about?: string; query?: string; limit?: number },
) {
  const { rows } = await runCypher<{ m: unknown }>(
    graph,
    `MATCH (m:Memory)
     WHERE ($kind IS NULL OR m.kind = $kind)
     OPTIONAL MATCH (m)-[:ABOUT]->(a)
     WITH m, collect(a.name) AS aboutNames
     WHERE ($about IS NULL OR $about IN aboutNames)
       AND ($query IS NULL OR toLower(m.value) CONTAINS toLower($query)
            OR toLower(m.key) CONTAINS toLower($query))
     RETURN m AS m ORDER BY m.at DESC LIMIT $limit`,
    {
      kind: opts.kind ?? null,
      about: opts.about ?? null,
      query: opts.query ?? null,
      limit: Math.max(1, Math.min(100, opts.limit ?? 20)),
    },
  );
  return rows.map((r) => r.m);
}

/**
 * Cross-session context for a tenant: recent incidents + memories, so a
 * returning operator doesn't start cold.
 */
export async function sessionContext(graph: Graph, tenantId: string) {
  const [incidents, memory] = await Promise.all([
    runCypher<{ i: unknown }>(
      graph,
      `MATCH (i:Incident) RETURN i AS i ORDER BY i.openedAt DESC LIMIT 5`,
    ),
    runCypher<{ m: unknown }>(
      graph,
      `MATCH (m:Memory) RETURN m AS m ORDER BY m.at DESC LIMIT 8`,
    ),
  ]);
  return {
    tenantId,
    incidents: incidents.rows.map((r) => r.i),
    memory: memory.rows.map((r) => r.m),
  };
}
