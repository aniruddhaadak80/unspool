---
title: "I made an incident-response agent whose reasoning is a graph you can replay"
published: false
tags: ai, graph, agents, falkordb
canonical_url: <fill in after publishing to DEV.to>
description: "Unspool stores every Cypher query, decision and action an agent takes as nodes in FalkorDB — then replays the reasoning on a canvas. Built for Graph Hacks 2026."
---

**AI disclosure:** this project was built with AI assistance (OpenCode). I designed the
graph model, Cypher, pipeline and UI; the AI generated scaffolding and code that I
reviewed, tested and edited. All demo data is synthetic.

---

Most agent demos hide the part that matters: *how* the agent got to its answer.

When an agent says "page Priya" during an incident, the interesting artifact isn't the
sentence — it's the path: which alert fired, which service it touched, which 3-hop
dependency traversal found the blast radius, which PageRank run picked the structurally
critical node, which runbook justified the page. That path is usually scattered across
log lines, if it exists at all.

For **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB), I built
**Unspool** — an incident-response agent that stores that path *in the same graph it
reasons over*, and replays it hop by hop on a canvas.

## The core idea: the trace is graph data, not a log file

The load-bearing design decision is one sentence long:

> An `:AgentRun` node `[:TOOK_STEP]->` ordered `:TraceStep` nodes, and each step
> `[:TOUCHES]->` the entities it read or wrote.

That's it. Every Cypher query the agent runs, every memory it recalls, every action it
takes gets written back into FalkorDB as nodes and edges, linked to the evidence that
justified it. Remove FalkorDB and the product has no answers, no memory, no provenance —
it fails the "removal test" by design.

The write-back query:

```cypher
MATCH (r:AgentRun {id:$runId})
CREATE (s:TraceStep {idx:$idx, kind:'query_graph', summary:$summary, cypher:$cypher})
CREATE (r)-[:TOOK_STEP]->(s)
WITH s
UNWIND $touches AS name
MATCH (e {name:name})
MERGE (s)-[:TOUCHES]->(e)
```

The UI reads that chain back and lights it up on a React Flow canvas: you *watch* the
reasoning move through the company graph — alert → service → dependency → runbook →
on-call → page.

## Everything else in the agent's world lives in the same graph

One FalkorDB graph per tenant holds: services, `DEPENDS_ON` edges, teams, people,
on-call rosters, runbooks, ADRs, tickets, postmortems, open incidents — **and** the
agent's episodic/semantic/procedural memory. So:

**Multi-hop reasoning instead of joins.**

```cypher
MATCH p = (s:Service {name:'checkout-api'})-[:DEPENDS_ON*1..3]->(dep:Service)
RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth
ORDER BY depth
```

**Graph algorithms as agent tools.** `CALL algo.pageRank('Service','DEPENDS_ON')` finds
structurally critical services; WCC/CDLP cluster failure domains; betweenness finds
bridge services. The agent picks them like any other tool.

**Cross-session memory, recalled with Cypher:**

```cypher
MATCH (m:Memory)
WHERE m.kind = 'semantic'
OPTIONAL MATCH (m)-[:ABOUT]->(a)
WITH m, collect(a.name) AS aboutNames
WHERE 'ledger' IN aboutNames
RETURN m ORDER BY m.at DESC LIMIT 20
```

**Actions with provenance.** When the agent pages the on-call, the `:Action` node is
linked to the `:Incident` it targeted and the `:Evidence` that authorized it. "Why was
Priya paged?" is itself a graph query.

## The pipeline: three specialists, state shared through the graph

The agent runs a **triage → investigator → commander** loop (AI SDK v7, OpenRouter):

1. **Triage** classifies the incident and picks what to look at.
2. **Investigator** runs Cypher, blast-radius traversals, algorithms, memory recall.
3. **Commander** writes the answer — and, if warranted, acts: page, open, resolve.

The specialists don't pass a chat log around — they share state *through the graph*.
Each stage reads what the previous stage wrote as nodes. That's the Track 02
(Agent Memory and Coordination) answer, and it falls out of the design instead of being
bolted on.

No API key? The orchestrator falls back to a deterministic **graph-replay mode** that
still executes real Cypher, real PageRank, real memory and action writes — so the demo
never depends on LLM availability.

The tools are defined **once** in a neutral registry and adapted to both AI SDK tools
and an MCP stdio server — same graph tools, drivable from Claude Desktop or Cursor:

```bash
FALKORDB_URL=falkor://... bun run mcp
```

## What I'd do differently

- **FalkorDB's parsed results are already JS objects.** My first normalizer called
  `toJSON()` on them and silently produced garbage. Read the client docs before
  normalizing.
- **Next.js 16's `cacheComponents` rejects `runtime` route exports.** If you're on a
  recent Next, check `node_modules/next/dist/docs/` before assuming API shapes from
  training data — mine was wrong in three places.
- **Budget a day for the replay canvas.** The trace-as-graph model was the easy part;
  making the hop-by-hop replay *legible* (highlighting the touched subgraph, dimming the
  rest, keeping 60fps on ~200 nodes) took the longest.

## Try it

```bash
git clone https://github.com/aniruddhaadak80/unspool
cd unspool && bun install
cp .env.example .env.local   # paste FALKORDB_URL (FalkorDB Cloud free tier)
bun run seed && bun run dev
```

Then ask: *"Why is checkout failing, and who should I page?"* — and watch the trace
unspool across the graph.

Built for Graph Hacks 2026, entering all three tracks. Repo:
[github.com/aniruddhaadak80/unspool](https://github.com/aniruddhaadak80/unspool)
