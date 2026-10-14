import type { Graph } from "falkordb";
import { runCypher } from "./falkordb";
import {
  normalizeEdge,
  normalizeNode,
  type GraphEdge,
  type GraphNode,
  type Subgraph,
} from "./schema";

/**
 * The Cypher toolkit the agent (and the UI) runs against FalkorDB.
 *
 * Notes on correctness with the official `falkordb` Node client:
 *  - Returning an entity (`RETURN e`) yields a client-parsed JS object
 *    {id, labels, properties} — no toJSON() needed.
 *  - `id(n)` gives the internal id, which we use to correlate nodes/edges
 *    between two queries without shipping names around.
 */

const limit = (n: number) => Math.max(1, Math.min(200, Math.floor(n)));

/** Search services, teams, people, documents and incidents by keyword. */
export async function findEntities(graph: Graph, term: string) {
  const { rows } = await runCypher<{ e: unknown }>(
    graph,
    `MATCH (e)
     WHERE (e:Service AND toLower(e.name) CONTAINS toLower($term))
        OR (e:Team   AND toLower(e.name) CONTAINS toLower($term))
        OR (e:Person AND toLower(e.name) CONTAINS toLower($term))
        OR (e:Document AND toLower(e.title) CONTAINS toLower($term))
        OR (e:Incident AND (toLower(e.title) CONTAINS toLower($term) OR toLower(e.id) CONTAINS toLower($term)))
        OR (e:Memory AND toLower(e.key) CONTAINS toLower($term))
     RETURN e
     LIMIT 25`,
    { term },
  );
  return rows.map((r) => normalizeNode(r.e)).filter(Boolean) as GraphNode[];
}

/** Who owns a service, who is on the team, and who is on call. */
export async function getServiceOwnership(graph: Graph, serviceName: string) {
  const { rows } = await runCypher<{
    service: unknown;
    team: unknown;
    members: unknown[];
    oncall: unknown[];
  }>(
    graph,
    `MATCH (s:Service {name:$serviceName})
     OPTIONAL MATCH (s)-[:OWNED_BY]->(t:Team)
     OPTIONAL MATCH (t)-[:HAS_MEMBER]->(m:Person)
     OPTIONAL MATCH (p:Person)-[:ONCALL_FOR]->(s)
     RETURN s AS service,
            t AS team,
            collect(DISTINCT m) AS members,
            collect(DISTINCT p) AS oncall`,
    { serviceName },
  );
  return rows[0] ?? null;
}

/** Multi-hop blast radius: everything downstream of a service. */
export async function blastRadius(graph: Graph, serviceName: string, hops = 3) {
  const { rows } = await runCypher<{ names: string[]; depth: number }>(
    graph,
    `MATCH p = (s:Service {name:$serviceName})-[:DEPENDS_ON*1..${limit(hops)}]->(dep:Service)
     RETURN [n IN nodes(p) | n.name] AS names,
            length(p) AS depth
     ORDER BY depth
     LIMIT 100`,
    { serviceName },
  );
  return rows;
}

/** Who depends ON the given service (upstream callers). */
export async function dependentsOf(graph: Graph, serviceName: string, hops = 3) {
  const { rows } = await runCypher<{ names: string[]; depth: number }>(
    graph,
    `MATCH p = (dep:Service)-[:DEPENDS_ON*1..${limit(hops)}]->(s:Service {name:$serviceName})
     RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth
     ORDER BY depth
     LIMIT 100`,
    { serviceName },
  );
  return rows;
}

/**
 * Pure builder for a read-only graph-algorithm call. Exported for tests: this
 * is the one place the agent (and the analysis panel) constructs algorithm
 * Cypher, so quote/escaping bugs live here and only here.
 */
export function buildAlgorithmCall(
  algo: "pageRank" | "wcc" | "cdlp" | "betweennessCentrality",
  label?: string,
  relType?: string,
): string {
  const L = label ? `'${label.replace(/'/g, "\\'")}'` : "NULL";
  const R = relType ? `'${relType.replace(/'/g, "\\'")}'` : "NULL";
  switch (algo) {
    case "pageRank":
      return `CALL algo.pageRank(${L}, ${R}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25`;
    case "betweennessCentrality":
      return `CALL algo.betweennessCentrality(${L}, ${R}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25`;
    case "wcc":
      return `CALL algo.WCC(${L}, ${R}) YIELD node, setId RETURN node, setId LIMIT 50`;
    case "cdlp":
      return `CALL algo.CDLP(${L}, ${R}) YIELD node, community RETURN node, community LIMIT 50`;
  }
}

/** Run a FalkorDB graph algorithm as an agent tool. */
export async function runAlgorithm(
  graph: Graph,
  algo: "pageRank" | "wcc" | "cdlp" | "betweennessCentrality",
  label?: string,
  relType?: string,
) {
  const call = buildAlgorithmCall(algo, label, relType);
  const { rows } = await runCypher<{ node: unknown; score?: number; setId?: number; community?: number }>(graph, call);
  return { algo, rows };
}

/** The literal reasoning path between two entities — the "red thread". */
export async function shortestPathBetween(
  graph: Graph,
  fromName: string,
  toName: string,
) {
  const { rows } = await runCypher<{
    nodes: Array<{ name?: string }>;
    edges: Array<{ relationshipType: string }>;
    len: number;
  }>(
    graph,
    `MATCH (a {name:$fromName}), (b {name:$toName})
     WITH a, b, shortestPath((a)-[*]-(b)) AS sp
     RETURN sp, length(sp) AS len`,
    { fromName, toName },
  );
  const r = rows[0];
  if (!r) return null;
  return {
    len: r.len,
    nodes: (r.nodes ?? []).map((n) => n.name ?? "?"),
    edges: (r.edges ?? []).map((e) => e.relationshipType),
  };
}

/** Documents referencing a service. */
export async function documentsFor(graph: Graph, serviceName: string) {
  const { rows } = await runCypher<{ d: unknown }>(
    graph,
    `MATCH (d:Document)-[:REFERENCES]->(:Service {name:$serviceName})
     RETURN d AS d ORDER BY d.at DESC LIMIT 20`,
    { serviceName },
  );
  return rows.map((r) => normalizeNode(r.d)).filter(Boolean) as GraphNode[];
}

/** Past incidents that touched a service. */
export async function pastIncidents(graph: Graph, serviceName: string) {
  const { rows } = await runCypher<{ i: unknown }>(
    graph,
    `MATCH (i:Incident)-[:AFFECTS]->(:Service {name:$serviceName})
     RETURN i AS i ORDER BY i.openedAt DESC LIMIT 10`,
    { serviceName },
  );
  return rows.map((r) => normalizeNode(r.i)).filter(Boolean) as GraphNode[];
}

/**
 * Focused neighborhood for the canvas: the seed entity + everything within
 * `hops`, capped so the UI stays readable.
 */
export async function subgraphAround(
  graph: Graph,
  seedName: string,
  hops = 2,
  maxNodes = 120,
): Promise<Subgraph> {
  const { rows } = await runCypher<{ e: unknown }>(
    graph,
    `MATCH (seed {name:$seedName})
     MATCH p = (seed)-[*0..${limit(hops)}]-(n)
     UNWIND nodes(p) AS node
     RETURN DISTINCT node AS e
     LIMIT $maxNodes`,
    { seedName, maxNodes: limit(maxNodes) },
  );
  const nodes = rows
    .map((r) => normalizeNode(r.e))
    .filter(Boolean) as GraphNode[];
  const ids = nodes.map((n) => Number(n.id));

  const { rows: edgeRows } = await runCypher<{ r: unknown }>(
    graph,
    `MATCH (a)-[r]-(b)
     WHERE id(a) IN $ids AND id(b) IN $ids
     RETURN r LIMIT 400`,
    { ids },
  );
  const edges = edgeRows
    .map((r) => normalizeEdge(r.r))
    .filter(Boolean) as GraphEdge[];
  return { nodes, edges };
}

/** Recent agent runs (with step counts) — powers the history panel. */
export async function recentRuns(graph: Graph, limitN = 12) {
  const { rows } = await runCypher<{
    run: unknown;
    stepCount: number;
  }>(
    graph,
    `MATCH (r:AgentRun)
     OPTIONAL MATCH (r)-[:TOOK_STEP]->(s:TraceStep)
     RETURN r AS run, count(s) AS stepCount
     ORDER BY r.startedAt DESC LIMIT $limitN`,
    { limitN: limit(limitN) },
  );
  return rows.map((r) => ({
    run: normalizeNode(r.run),
    stepCount: r.stepCount,
  }));
}

/** Memories, optionally filtered by kind or by the entity they are ABOUT. */
export async function memories(
  graph: Graph,
  kind?: "episodic" | "semantic" | "procedural",
  aboutName?: string,
) {
  const { rows } = await runCypher<{ m: unknown }>(
    graph,
    `MATCH (m:Memory)
     WHERE ($kind IS NULL OR m.kind = $kind)
     OPTIONAL MATCH (m)-[:ABOUT]->(a)
     WITH m, collect(coalesce(a.name, a.id)) AS aboutNames
     WHERE $aboutName IS NULL OR $aboutName IN aboutNames
     RETURN m AS m ORDER BY m.at DESC LIMIT 50`,
    { kind: kind ?? null, aboutName: aboutName ?? null },
  );
  return rows.map((r) => normalizeNode(r.m)).filter(Boolean) as GraphNode[];
}
