import type { Graph } from "falkordb";
import { runCypher } from "@/lib/graph/falkordb";
import type { TraceStepKind } from "@/lib/graph/schema";

/**
 * The trace is not a log file — it's a graph. Each agent run is an `:AgentRun`
 * node; every step it takes is a `:TraceStep` node it `[:TOOK_STEP]->`, in
 * order. When a step reads or writes a `:Memory` or touches a domain entity,
 * it `[:TOUCHES]->` that node too. That's what lets the UI replay "how the
 * agent got here" as a highlighted subgraph, and what lets a judge query the
 * provenance of any answer with plain Cypher.
 */

let seq = 0;
export function newRunId(): string {
  seq = (seq + 1) % 100000;
  return `run_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export async function startRun(
  graph: Graph,
  runId: string,
  agent: string,
  prompt: string,
) {
  await runCypher(
    graph,
    `CREATE (r:AgentRun {id:$id, agent:$agent, prompt:$prompt, startedAt:timestamp()})
     RETURN r.id AS id`,
    { id: runId, agent, prompt },
  );
}

export interface TraceStepInput {
  runId: string;
  idx: number;
  kind: TraceStepKind;
  summary: string;
  cypher?: string;
  detail?: string;
  /** names of domain entities / memory keys this step touched */
  touches?: string[];
}

export async function recordStep(graph: Graph, step: TraceStepInput) {
  await runCypher(
    graph,
    `MATCH (r:AgentRun {id:$runId})
     CREATE (s:TraceStep {idx:$idx, kind:$kind, summary:$summary,
                          cypher:$cypher, detail:$detail, at:timestamp()})
     CREATE (r)-[:TOOK_STEP]->(s)
     WITH s
     UNWIND $touches AS name
     MATCH (e {name:name})
     MERGE (s)-[:TOUCHES]->(e)`,
    {
      runId: step.runId,
      idx: step.idx,
      kind: step.kind,
      summary: step.summary,
      cypher: step.cypher ?? null,
      detail: step.detail ?? null,
      touches: step.touches ?? [],
    },
  );
}

export async function finishRun(
  graph: Graph,
  runId: string,
  answer: string,
) {
  await runCypher(
    graph,
    `MATCH (r:AgentRun {id:$runId}) SET r.answer = $answer, r.finishedAt = timestamp()
     RETURN r.id AS id`,
    { runId, answer },
  );
}

/** Read a full run trace back for the replay UI. */
export async function getRunTrace(graph: Graph, runId: string) {
  const { rows } = await runCypher<{
    run: unknown;
    steps: unknown[];
    touched: string[];
  }>(
    graph,
    `MATCH (r:AgentRun {id:$runId})
     OPTIONAL MATCH (r)-[:TOOK_STEP]->(s:TraceStep)
     WITH r, s ORDER BY s.idx
     OPTIONAL MATCH (s)-[:TOUCHES]->(e)
     RETURN r AS run,
            collect(DISTINCT s) AS steps,
            collect(DISTINCT e.name) AS touched`,
    { runId },
  );
  return rows[0] ?? null;
}
