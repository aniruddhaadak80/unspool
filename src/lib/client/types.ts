/** Shapes returned by the Unspool API, shared by the client components. */

export interface CanvasNode {
  id: string;
  label: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
}

export interface TraceStepProps {
  idx: number;
  kind: "read_memory" | "query_graph" | "algorithm" | "write_memory" | "decide" | "act";
  summary: string;
  cypher?: string | null;
  detail?: string | null;
  at?: number;
}

export interface TraceStep {
  id: string;
  labels: string[];
  properties: TraceStepProps;
  /** entity names this step touched (drives canvas highlighting) */
  touches?: string[];
}

export interface AgentResult {
  runId: string;
  answer: string;
  stages: Array<{ stage: string; summary: string; detail?: string }>;
  acted: boolean;
  live: boolean;
  steps: TraceStep[];
  graphStats?: { nodes: number; rels: number };
}

export interface MemorySets {
  episodic: CanvasNode[];
  semantic: CanvasNode[];
  procedural: CanvasNode[];
}

export interface Health {
  falkordb: "ok" | "unconfigured" | "error";
  detail?: string;
  agent: "live-llm" | "graph-replay";
  model: string;
}
