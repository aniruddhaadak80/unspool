import { z } from "zod";
import type { Graph } from "falkordb";
import {
  blastRadius,
  dependentsOf,
  documentsFor,
  findEntities,
  getServiceOwnership,
  pastIncidents,
  runAlgorithm,
  shortestPathBetween,
  subgraphAround,
} from "@/lib/graph/queries";
import { recall, writeMemory } from "@/lib/agent/memory";
import { recordStep } from "@/lib/agent/trace";
import type { TraceStepKind } from "@/lib/graph/schema";
import {
  actCreateIncident,
  actPageOnCall,
  actResolveIncident,
} from "@/lib/agent/actions";

/**
 * THE tool registry — one definition per capability, neutral between AI SDK
 * and MCP. `tools.ts` adapts these to AI SDK `tool()`s for the in-process
 * agent; `mcp.ts` adapts the SAME defs to an MCP server for any external
 * client (Claude Desktop, Codex, Cursor…). Every FalkorDB-touching handler
 * also writes a :TraceStep, so reasoning from any surface lands in the graph.
 */

export interface ToolContext {
  graph: Graph;
  runId: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** zod v4 schema (AI SDK uses it directly; MCP converts to JSON schema) */
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, never> | unknown, ctx: ToolContext) => Promise<unknown>;
  /** ACT tools change state; surfaced distinctly in the UI/MCP list */
  sideEffecting?: boolean;
}

export function toolDefs(ctx: ToolContext): ToolDef[] {
  const { graph, runId } = ctx;
  let idx = 0;
  const step = async (
    kind: TraceStepKind,
    summary: string,
    touches: string[] = [],
    cypher?: string,
    detail?: string,
  ) => {
    idx += 1;
    await recordStep(graph, { runId, idx, kind, summary, cypher, detail, touches });
  };

  return [
    {
      name: "find_entities",
      description:
        "Search services, teams, people, documents, incidents and memories by a fuzzy name or keyword. Use FIRST whenever the user mentions an entity you are not sure about.",
      schema: z.object({ term: z.string().describe("Name or keyword") }),
      handler: async (a) => {
        const { term } = a as { term: string };
        const nodes = await findEntities(graph, term);
        await step("query_graph", `Find entities matching “${term}”`, [term]);
        return nodes.map((n) => ({ label: n.labels[0], name: n.label, props: n.properties }));
      },
    },
    {
      name: "service_ownership",
      description:
        "Resolve who owns a service, the full team roster, and who is currently on call. Use before deciding who to page.",
      schema: z.object({ service: z.string() }),
      handler: async (a) => {
        const { service } = a as { service: string };
        const r = await getServiceOwnership(graph, service);
        await step("query_graph", `Resolve ownership + on-call for ${service}`, [service]);
        return r;
      },
    },
    {
      name: "blast_radius",
      description:
        "Walk the DEPENDS_ON graph N hops OUT from a service: everything that breaks if it fails (downstream impact).",
      schema: z.object({
        service: z.string(),
        hops: z.number().int().min(1).max(5).default(3),
      }),
      handler: async (a) => {
        const { service, hops = 3 } = a as { service: string; hops?: number };
        const rows = await blastRadius(graph, service, hops);
        await step(
          "query_graph",
          `Blast radius: ${hops} hops downstream of ${service} → ${rows.length} paths`,
          [service],
          `MATCH p=(:Service {name:$serviceName})-[:DEPENDS_ON*1..${hops}]->(:Service) RETURN names, depth`,
        );
        return rows;
      },
    },
    {
      name: "dependents",
      description:
        "Walk DEPENDS_ON hops INWARD: which services depend on this one (upstream callers).",
      schema: z.object({
        service: z.string(),
        hops: z.number().int().min(1).max(5).default(3),
      }),
      handler: async (a) => {
        const { service, hops = 3 } = a as { service: string; hops?: number };
        const rows = await dependentsOf(graph, service, hops);
        await step("query_graph", `Upstream dependents of ${service} → ${rows.length} paths`, [service]);
        return rows;
      },
    },
    {
      name: "run_algorithm",
      description:
        "Run a FalkorDB graph algorithm as a tool. pageRank = structurally critical services; wcc/cdlp = cluster services into failure domains; betweennessCentrality = bridge services whose failure splits the graph.",
      schema: z.object({
        algo: z.enum(["pageRank", "wcc", "cdlp", "betweennessCentrality"]),
        label: z.string().optional().describe("Restrict to a node label, e.g. Service"),
        relType: z.string().optional().describe("Restrict to a relationship type, e.g. DEPENDS_ON"),
      }),
      handler: async (a) => {
        const { algo, label, relType } = a as { algo: "pageRank" | "wcc" | "cdlp" | "betweennessCentrality"; label?: string; relType?: string };
        const r = await runAlgorithm(graph, algo, label ?? "Service", relType ?? "DEPENDS_ON");
        await step(
          "algorithm",
          `Run ${algo} over Service/DEPENDS_ON`,
          [],
          `CALL algo.${algo}('Service','DEPENDS_ON') YIELD node …`,
          "Computed by FalkorDB's matrix engine — not by the LLM.",
        );
        return r.rows.slice(0, 15).map((row) => ({
          name: (row.node as { properties?: { name?: string } })?.properties?.name ?? "?",
          score: row.score ?? row.setId ?? row.community ?? null,
        }));
      },
    },
    {
      name: "shortest_reasoning_path",
      description:
        'Find the shortest relationship path between two named entities — the literal "red thread" connecting them. Great for explaining WHY two things are related.',
      schema: z.object({ from: z.string(), to: z.string() }),
      handler: async (a) => {
        const { from, to } = a as { from: string; to: string };
        const r = await shortestPathBetween(graph, from, to);
        await step("query_graph", `Shortest path ${from} ⇄ ${to}`, [from, to],
          `MATCH (a {name:$from}),(b {name:$to}) WITH shortestPath((a)-[*]-(b)) AS p RETURN p`);
        return r;
      },
    },
    {
      name: "documents_for",
      description: "List runbooks, ADRs, tickets, Slack notes and postmortems that reference a service.",
      schema: z.object({ service: z.string() }),
      handler: async (a) => {
        const { service } = a as { service: string };
        const docs = await documentsFor(graph, service);
        await step("query_graph", `Documents referencing ${service}`, [service]);
        return docs.map((d) => d.properties);
      },
    },
    {
      name: "past_incidents",
      description: "Recall past incidents that affected a service — episodic memory grounded in the graph.",
      schema: z.object({ service: z.string() }),
      handler: async (a) => {
        const { service } = a as { service: string };
        const inc = await pastIncidents(graph, service);
        await step("read_memory", `Recall past incidents touching ${service}`, [service]);
        return inc.map((i) => i.properties);
      },
    },
    {
      name: "recall_memory",
      description:
        "Recall agent memory across sessions. kinds: episodic (what happened), semantic (durable facts), procedural (how to act). Filter by entity and/or keyword.",
      schema: z.object({
        kind: z.enum(["episodic", "semantic", "procedural"]).optional(),
        about: z.string().optional().describe("Entity the memory is about"),
        query: z.string().optional().describe("Keyword filter"),
      }),
      handler: async (a) => {
        const { kind, about, query } = a as { kind?: "episodic" | "semantic" | "procedural"; about?: string; query?: string };
        const mem = await recall(graph, { kind, about, query });
        await step("read_memory", `Recall ${kind ?? "any"} memory${about ? ` about ${about}` : ""}`, about ? [about] : []);
        return mem;
      },
    },
    {
      name: "write_memory",
      description:
        "Persist a memory so it survives across sessions and is available to other agents. episodic (an event), semantic (a durable fact), procedural (a rule for how to act).",
      schema: z.object({
        kind: z.enum(["episodic", "semantic", "procedural"]),
        key: z.string(),
        value: z.string(),
        about: z.array(z.string()).optional().describe("Entity names this memory is about"),
      }),
      handler: async (a) => {
        const { kind, key, value, about } = a as { kind: "episodic" | "semantic" | "procedural"; key: string; value: string; about?: string[] };
        await writeMemory(graph, { kind, key, value, about });
        await step("write_memory", `Write ${kind} memory “${key}”`, about ?? []);
        return { ok: true, key };
      },
    },
    {
      name: "page_on_call",
      description:
        "ACT: page the on-call engineer for a service and open an incident. Only call once you have evidence from the graph. The page and its justification are recorded in the graph.",
      sideEffecting: true,
      schema: z.object({
        service: z.string(),
        reason: z.string().describe("The evidence-backed reason, shown to the responder"),
        severity: z.number().int().min(1).max(4).default(2),
      }),
      handler: async (a) => {
        const { service, reason, severity = 2 } = a as { service: string; reason: string; severity?: number };
        const r = await actPageOnCall(graph, { service, reason, severity });
        await step("act", `PAGE on-call for ${service} (SEV${severity})`, [service, r.incidentId], undefined, reason);
        return r;
      },
    },
    {
      name: "create_incident",
      description: "ACT: open a formal incident record linked to the affected services.",
      sideEffecting: true,
      schema: z.object({
        title: z.string(),
        severity: z.number().int().min(1).max(4),
        services: z.array(z.string()),
      }),
      handler: async (a) => {
        const { title, severity, services } = a as { title: string; severity: number; services: string[] };
        const r = await actCreateIncident(graph, { title, severity, services });
        await step("act", `Open incident “${title}” (SEV${severity})`, services);
        return r;
      },
    },
    {
      name: "resolve_incident",
      description: "ACT: mark an incident resolved and record the resolution.",
      sideEffecting: true,
      schema: z.object({ id: z.string(), resolution: z.string() }),
      handler: async (a) => {
        const { id, resolution } = a as { id: string; resolution: string };
        const r = await actResolveIncident(graph, { id, resolution });
        await step("act", `Resolve ${id}`, [id], undefined, resolution);
        return r;
      },
    },
    {
      name: "focus_subgraph",
      description:
        "Load the focused neighborhood around an entity for visualization (entity + everything within N hops). Use to center the canvas on something.",
      schema: z.object({
        seed: z.string(),
        hops: z.number().int().min(1).max(3).default(2),
      }),
      handler: async (a) => {
        const { seed, hops = 2 } = a as { seed: string; hops?: number };
        const sub = await subgraphAround(graph, seed, hops);
        await step("query_graph", `Focus canvas on ${seed} (${hops} hops)`, [seed]);
        return { nodes: sub.nodes.length, edges: sub.edges.length, seed };
      },
    },
  ];
}
