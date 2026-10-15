/**
 * The Unspool property-graph schema.
 *
 * One graph per tenant. Node labels and relationship types are the contract
 * between the seed data, the agent's Cypher tools, and the trace UI. Every
 * relationship type below is actually created — the seeder writes the first
 * group, the agent writes the second. `tests/graph-contract.test.ts` fails if
 * any Cypher in the codebase traverses a type that nothing ever creates.
 *
 *   (:Service {name, tier, language, repo})
 *     -[:DEPENDS_ON {latencyMs, critical}]->  (:Service)
 *     -[:OWNED_BY]->                          (:Team)
 *     -[:RUNS_IN]->                           (:Cluster)
 *
 *   (:Team {name})   -[:HAS_MEMBER]->  (:Person {name, role, timezone})
 *   (:Person)        -[:ONCALL_FOR]->  (:Service)
 *
 *   (:Document {id, kind, title, body})   kind in runbook|adr|slack|ticket|postmortem
 *   (:Document)-[:REFERENCES]->(:Service)
 *
 *   (:Incident {id, severity, status, openedAt, title}) -[:AFFECTS]-> (:Service)
 *   (:Alert {name, threshold, window})                  -[:FIRES_ON]-> (:Service)
 *
 *   (:Memory {kind, key, value, at})  kind in episodic|semantic|procedural
 *     -[:ABOUT]->  (:Service | :Person | :Incident | :Team | :Document | :Memory)
 *
 *   ---- written by the agent at runtime ----
 *   (:AgentRun {id, agent, startedAt})
 *     -[:TOOK_STEP]->(:TraceStep {idx, kind, cypher, summary})
 *     -[:WROTE]->(:Memory)
 *   (:TraceStep)-[:TOUCHES]->(:any entity)
 *   (:Action {kind, at, reason, severity})
 *     -[:TARGETS]->       (:Incident)
 *     -[:AUTHORIZED_BY]-> (:Decision {id, kind, rationale, at})
 *   (:Decision)-[:BASED_ON]->(:Evidence {ref, kind, at})
 *   (:Evidence)-[:ABOUT]->(:any entity)
 */

/**
 * The canonical relationship types — single source of truth for the graph
 * contract. Tests assert that every type traversed in the codebase is created
 * somewhere and that every created type is listed here, so a query can never
 * join on an edge the seeder doesn't write.
 */
export const REL_TYPES = [
  // written by the seeder
  "DEPENDS_ON",
  "OWNED_BY",
  "RUNS_IN",
  "HAS_MEMBER",
  "ONCALL_FOR",
  "REFERENCES",
  "AFFECTS",
  "FIRES_ON",
  "ABOUT",
  // written by the agent at runtime
  "TOOK_STEP",
  "WROTE",
  "TOUCHES",
  "TARGETS",
  "AUTHORIZED_BY",
  "BASED_ON",
] as const;
export type RelType = (typeof REL_TYPES)[number];


export type MemoryKind = "episodic" | "semantic" | "procedural";
export type DocumentKind = "runbook" | "adr" | "slack" | "ticket" | "postmortem";
export type TraceStepKind =
  | "read_memory"
  | "query_graph"
  | "algorithm"
  | "write_memory"
  | "decide"
  | "act";

/** A node as parsed by the falkordb client ({id, labels, properties}). */
export interface GraphNode {
  id: string;
  label: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface RawNode {
  id?: number | string;
  labels?: string[];
  properties?: Record<string, unknown>;
}

interface RawEdge {
  id?: number | string;
  relationshipType?: string;
  sourceId?: number | string;
  destinationId?: number | string;
  properties?: Record<string, unknown>;
}

/** Normalize a client-parsed node into the UI's GraphNode shape. */
export function normalizeNode(raw: unknown): GraphNode | null {
  const n = raw as RawNode;
  if (!n || typeof n !== "object" || !Array.isArray(n.labels)) return null;
  const props = n.properties ?? {};
  return {
    id: String(n.id),
    label:
      (props.name as string) ??
      (props.title as string) ??
      (props.key as string) ??
      (props.id as string) ??
      String(n.id),
    labels: n.labels,
    properties: props,
  };
}

/** Normalize a client-parsed relationship into the UI's GraphEdge shape. */
export function normalizeEdge(raw: unknown): GraphEdge | null {
  const e = raw as RawEdge;
  if (!e || typeof e !== "object" || e.relationshipType === undefined) return null;
  return {
    id: String(e.id),
    type: e.relationshipType,
    source: String(e.sourceId),
    target: String(e.destinationId),
    properties: e.properties ?? {},
  };
}
