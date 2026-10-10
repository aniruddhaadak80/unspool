/**
 * The Unspool property-graph schema.
 *
 * One graph per tenant. Node labels and relationship types are the contract
 * between the seed data, the agent's Cypher tools, and the trace UI.
 *
 *   (:Service {name, tier, language, repo})
 *     -[:DEPENDS_ON {latencyMs, critical}]->      (:Service)
 *     -[:OWNED_BY]->                              (:Team)
 *     -[:EXPOSED_AS]->                            (:Endpoint)
 *     -[:IN_CLUSTER]->                             (:Cluster)
 *     -[:EMITS]->                                  (:Metric)
 *
 *   (:Team {name})  -[:HAS_MEMBER]->  (:Person {name, role, timezone})
 *   (:Person)       -[:ONCALL_FOR]->  (:Service)
 *   (:Person)       -[:AUTHORED]->    (:Document)
 *
 *   (:Document {id, kind, title, body})   kind in runbook|adr|slack|ticket|postmortem
 *   (:Document)-[:REFERENCES]->(:Service)
 *   (:Decision {id, at})  -[:LED_TO]->    (:Decision | :Service | :Document)
 *   (:Decision)-[:BASED_ON]->(:Evidence {kind, source, at})
 *
 *   (:Incident {id, severity, status, openedAt, title})
 *     -[:AFFECTS]->        (:Service)
 *     -[:TRIGGERED_BY]->   (:Alert)
 *     -[:RESOLVED_BY]->    (:Action)
 *   (:Alert {name, threshold, window})
 *
 *   (:Memory {kind, key, value, at})  kind in episodic|semantic|procedural
 *     -[:ABOUT]->          (:Service | :Person | :Incident | :Team)
 *   (:AgentRun {id, agent, startedAt}) -[:WROTE]->(:Memory)
 *                                   -[:TOOK_STEP]->(:TraceStep {idx, kind, cypher, summary})
 */

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
