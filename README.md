# Unspool — incident command that shows its work

**A graph-native incident-response agent built on FalkorDB.** Every answer the agent gives is *traced*: each Cypher query, graph algorithm, memory recall, decision and action it takes is written back into FalkorDB as nodes and edges — and the UI replays that trace on a live company graph, hop by hop.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB, Oct 15–18 2026). Enters **all three tracks**.

![stack](https://img.shields.io/badge/stack-Next.js_16_·_React_19_·_TypeScript_·_FalkorDB-ff8101)
![agent](https://img.shields.io/badge/agent-AI_SDK_v7_·_OpenRouter_·_MCP-58a6ff)
![ui](https://img.shields.io/badge/ui-React_Flow_·_Tailwind_4-3fb950)
![ci](https://github.com/aniruddhaadak80/unspool/actions/workflows/ci.yml/badge.svg)

**▶ [Live demo](https://unspool-red.vercel.app)** · [Source](https://github.com/aniruddhaadak80/unspool) · [Graph model](docs/GRAPH-MODEL.md) · [Blog post](docs/BLOG-POST.md)

---

## The one-minute pitch

Agents see pieces, not the whole picture. Unspool puts an incident responder's entire world — services, dependencies, teams, on-call rosters, runbooks, ADRs, past incidents, and the agent's own memory — into **one FalkorDB graph**, and makes the agent *reason over connections*:

- **Multi-hop reasoning** — "what breaks if the ledger goes down?" is a 3-hop `DEPENDS_ON` traversal, not a join.
- **Graph algorithms as tools** — PageRank finds structurally critical services; WCC/CDLP cluster failure domains; betweenness finds bridge services.
- **Memory that survives sessions** — episodic / semantic / procedural memory stored *as graph nodes*, recalled with Cypher.
- **Multi-agent coordination** — triage → investigator → commander specialists share state through the graph itself.
- **Actions with provenance** — when the agent pages someone or opens an incident, the action is a graph node linked to the evidence that justified it.
- **Explainability** — every answer ships with a replayable trace: watch the reasoning light up on the canvas.

## The demo story (what judges see)

A synthetic company, **acme**, is mid-incident: `checkout-api` is throwing 5xx after a ledger migration.

1. **"Why is checkout failing, and who should I page?"**
   The agent recalls semantic memory (`cascade-pattern`: ledger → risk-engine → payments-gateway → checkout), walks the blast radius 3 hops, runs PageRank over `Service/DEPENDS_ON`, pulls the ledger runbook + ADR-42 + postmortem PM-118, and **pages Priya Nair** (on-call for `payments-gateway`) — opening incident `INC-2041` in the graph.
2. **"What breaks if the ledger goes down?"** — blast radius + dependents + betweenness, with the path highlighted on the canvas.
3. **"What did we learn from the last payments incident?"** — episodic memory recall across sessions.
4. Switch tenant to `acme-staging` — **separate graph, separate memory** (FalkorDB multigraph), zero redeploys.

## Architecture

```mermaid
flowchart LR
  subgraph Client["Browser — mission control UI"]
    Chat["Command channel"]
    Canvas["Live graph canvas<br/>(React Flow)"]
    Trace["Reasoning trace + memory panels"]
  end

  subgraph Edge["Vercel — Next.js 16 (App Router)"]
    API["/api/agent · /api/graph · /api/runs · /api/seed"]
    Orch["3-stage agent pipeline<br/>triage → investigator → commander"]
    Tools["Neutral tool registry<br/>(AI SDK tools ⇄ MCP tools)"]
  end

  subgraph GraphDB["FalkorDB — one instance, many graphs"]
    G1["unspool_demo<br/>services · people · docs<br/>memory · incidents · traces"]
    G2["unspool_acme<br/>isolated tenant graph"]
  end

  LLM["LLM<br/>(OpenRouter / OpenAI-compatible)"]

  Chat --> API
  Canvas --> API
  Trace --> API
  API --> Orch --> Tools
  Tools -- "Cypher · algo.* · memory writes" --> G1
  Tools -- "Cypher · algo.* · memory writes" --> G2
  Orch -- "tool calling" --> LLM
  G1 -. "every step written back as nodes/edges" .-> Trace
```

**The load-bearing idea:** the trace is not a log file — it *is* graph data. An `:AgentRun` node `[:TOOK_STEP]->` ordered `:TraceStep` nodes; each step `[:TOUCHES]->` the entities it read or wrote. Remove FalkorDB and the product has no answers, no memory, no provenance — it fails the removal test by design.

## Graph data model

One graph per tenant. Node labels and relationship types are the contract between the seed data, the agent's Cypher tools, and the replay UI.

```mermaid
erDiagram
    Service ||--o{ Service : "DEPENDS_ON (latencyMs, critical)"
    Service }o--|| Team : "OWNED_BY"
    Team ||--o{ Person : "HAS_MEMBER"
    Person ||--o{ Service : "ONCALL_FOR"
    Person ||--o{ Document : "AUTHORED"
    Document }o--o{ Service : "REFERENCES"
    Incident }o--o{ Service : "AFFECTS"
    Alert }o--|| Service : "FIRES_ON"
    Memory }o--o{ Service : "ABOUT"
    Memory }o--o{ Person : "ABOUT"
    Memory }o--o{ Incident : "ABOUT"
    Memory }o--o{ Document : "ABOUT"
    AgentRun ||--o{ TraceStep : "TOOK_STEP"
    AgentRun ||--o{ Memory : "WROTE"
    TraceStep }o--o{ Service : "TOUCHES"
    Action }o--|| Incident : "TARGETS"
    Action }o--|| Decision : "AUTHORIZED_BY"
    Decision }o--o{ Evidence : "BASED_ON"
    Evidence }o--|| Service : "ABOUT"
```

| Label | Key properties | Meaning |
|---|---|---|
| `Service` | `name, tier, language, repo` | A deployable in the topology |
| `Team` / `Person` | `name, role, timezone` | Ownership + on-call |
| `Document` | `id, kind, title, body, at` | runbook · adr · slack · ticket · postmortem |
| `Incident` | `id, title, severity, status, openedAt` | Open/resolved incidents |
| `Alert` | `name, threshold, window` | Monitoring alerts |
| `Memory` | `kind, key, value, at` | episodic · semantic · procedural |
| `AgentRun` | `id, agent, prompt, startedAt, answer` | One reasoning run |
| `TraceStep` | `idx, kind, summary, cypher, detail` | One step in a run |
| `Action` | `kind, at, reason, severity` | page / create / resolve |
| `Decision` | `id, kind, rationale, at` | The reasoning that authorized an action |
| `Evidence` | `ref, kind, at` | A graph fact the decision was based on |

## The Cypher the product depends on

**Blast radius (multi-hop reasoning):**
```cypher
MATCH p = (s:Service {name:'checkout-api'})-[:DEPENDS_ON*1..3]->(dep:Service)
RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth
ORDER BY depth
```

**Graph algorithm as an agent tool (PageRank over the service graph):**
```cypher
CALL algo.pageRank('Service','DEPENDS_ON')
YIELD node, score
RETURN node, score ORDER BY score DESC LIMIT 25
```

**The "red thread" — shortest reasoning path between two entities:**
```cypher
MATCH (a {name:'checkout-api'}), (b {name:'ledger'})
WITH a, b, shortestPath((a)-[*]-(b)) AS sp
RETURN sp, length(sp) AS len
```

**Cross-session memory recall (episodic/semantic/procedural):**
```cypher
MATCH (m:Memory)
WHERE m.kind = 'semantic'
OPTIONAL MATCH (m)-[:ABOUT]->(a)
WITH m, collect(coalesce(a.name, a.id)) AS aboutNames
WHERE 'ledger' IN aboutNames
RETURN m ORDER BY m.at DESC LIMIT 20
```

**Writing the trace (every agent step becomes a graph node):**
```cypher
MATCH (r:AgentRun {id:$runId})
CREATE (s:TraceStep {idx:$idx, kind:'query_graph', summary:$summary, cypher:$cypher})
CREATE (r)-[:TOOK_STEP]->(s)
WITH s
UNWIND $touches AS name
MATCH (e) WHERE e.name = name OR e.id = name
MERGE (s)-[:TOUCHES]->(e)
```

**Acting with provenance (page the on-call, attach to the incident, record the decision):**
```cypher
MATCH (s:Service {name:$service})-[:OWNED_BY]->(:Team)-[:HAS_MEMBER]->(p:Person)-[:ONCALL_FOR]->(s)
MATCH (i:Incident {status:'open'})-[:AFFECTS]->(s)
CREATE (a:Action {kind:'page', at:timestamp(), reason:$reason, severity:$severity})
CREATE (d:Decision {id:$decisionId, kind:'page', rationale:$reason, at:timestamp()})
CREATE (a)-[:AUTHORIZED_BY]->(d)
CREATE (a)-[:TARGETS]->(i)
WITH d
UNWIND $evidence AS ref
MATCH (e) WHERE e.name = ref OR e.id = ref
MERGE (ev:Evidence {ref: ref}) ON CREATE SET ev.at = timestamp()
MERGE (d)-[:BASED_ON]->(ev)
MERGE (ev)-[:ABOUT]->(e)
```

**"Why was Priya paged?" — the whole justification in one match:**
```cypher
MATCH (a:Action {kind:'page'})-[:AUTHORIZED_BY]->(d:Decision)-[:BASED_ON]->(ev:Evidence)-[:ABOUT]->(e)
RETURN d.rationale AS why, collect(DISTINCT coalesce(e.name, e.id)) AS evidence
```

## Quickstart

### 1. Get FalkorDB (free, no credit card)

**FalkorDB Cloud** (recommended — no local setup):
1. Sign up at <https://app.falkordb.cloud/signup>
2. Create a **Free** instance (AWS or GCP)
3. Copy the connection string — it looks like `falkor://default:password@host:6379`

**Or Docker locally:**
```bash
docker run -p 6379:6379 -p 3000:3000 -it --rm falkordb/falkordb:latest
```

### 2. Run the app

```bash
bun install
cp .env.example .env.local
#   → paste your FALKORDB_URL (and optionally OPENROUTER_API_KEY)
bun run seed        # build the synthetic company graph
bun run verify      # live smoke test: every query + the action/provenance loop
bun run dev         # http://localhost:3000
bun test            # 35 unit tests: seed integrity, normalizers, Cypher builders
```

Open <http://localhost:3000>, click **re-seed graph** if needed, then ask:
> *"Why is checkout failing, and who should I page?"*

### 3. Explore it like a judge

Two built-in tools sit under the graph canvas:

- **analysis** — runs `algo.pageRank` / `algo.WCC` / `algo.labelPropagation` / `algo.betweenness` live and
  shows the structurally critical services, failure islands and bridge services.
- **cypher console** — run any read-only Cypher (the queries above are one click each).
  Write clauses (`CREATE`, `MERGE`, `SET`, `DELETE`, …) are rejected server-side.

### 4. (Optional) Live LLM mode

Without an API key the agent runs in **graph-replay mode** — a deterministic pipeline that still executes real Cypher, real PageRank, real memory writes and real action writes (clearly labeled in the UI). Add `OPENROUTER_API_KEY` (or any OpenAI-compatible key via `AGENT_BASE_URL`) to get the full LLM-driven triage → investigator → commander loop.

## Staying live on the free tier

FalkorDB **Free** instances are stopped after 1 day of inactivity and deleted after 7
(no backups). Unspool defends against a cold graph two ways:

- `/api/cron/keepalive` — touches FalkorDB (that counts as utilization) and **re-seeds
  any tenant whose graph is empty**, so the demo is never a blank canvas.
- `vercel.json` runs it twice a day; `.github/workflows/keepalive.yml` pings the
  deployment every 6 hours as a backup (set repo variable `UNSPOOL_URL` and, if you set
  `CRON_SECRET` on Vercel, the same value as a repo secret).

## MCP — tool selection through the protocol

The agent's tools are defined **once** in a neutral registry (`src/lib/agent/registry.ts`) and adapted to both AI SDK and MCP. Any MCP client can drive the same graph tools:

```bash
FALKORDB_URL=falkor://... bun run mcp
```

Register in Claude Desktop / Cursor:
```json
{
  "command": "bun",
  "args": ["scripts/mcp-server.ts"],
  "env": { "FALKORDB_URL": "falkor://default:password@host:6379" }
}
```

Tools: `find_entities · service_ownership · blast_radius · dependents · run_algorithm · shortest_reasoning_path · documents_for · past_incidents · recall_memory · write_memory · page_on_call · create_incident · resolve_incident · focus_subgraph`

## Tracks entered

| Track | How Unspool answers it |
|---|---|
| **01 — Agents That Act on Connected Data** | Multi-hop `DEPENDS_ON` traversal; `algo.pageRank`/`WCC`/`labelPropagation`/`betweenness` as agent tools; MCP tool selection; **acts** (pages on-call, opens/resolves incidents) with every action traced to its evidence; explainable results via the replay UI |
| **02 — Agent Memory and Coordination** | Episodic/semantic/procedural memory as graph nodes; persistent across sessions; triage→investigator→commander handoffs share state through the graph; per-tenant isolated graphs (FalkorDB multigraph) |
| **03 — Company Brain** | People, teams, services, runbooks, ADRs, tickets, postmortems and decisions in one graph; "who owns what / who knows what" is a one-hop query; decisions trace back to sources; answers cite `[bracketed]` sources |

## Project layout

```
src/
  app/
    page.tsx                 # mission-control UI (chat + canvas + trace + memory)
    api/
      agent/route.ts         # POST — run one reasoning turn (per-tenant)
      graph/route.ts         # GET  — focused subgraph for the canvas
      runs/route.ts          # GET  — trace + memory panels
      seed/route.ts          # POST — (re)build a tenant's graph
      health/route.ts        # GET  — connection + capability probe
      cron/keepalive/route.ts# GET  — keep the free instance warm + self-heal
      cypher/route.ts        # POST — read-only Cypher console
      analysis/route.ts      # GET  — pageRank / WCC / betweenness X-ray
  lib/
    graph/falkordb.ts        # connection + multigraph-per-tenant
    graph/queries.ts         # the Cypher toolkit
    graph/seed.ts            # synthetic company + idempotent seeder
    graph/schema.ts          # data model + normalizers
    agent/registry.ts        # neutral tool registry (single source of truth)
    agent/tools.ts           # AI SDK adapter
    agent/mcp.ts             # MCP adapter (same registry)
    agent/orchestrator.ts    # 3-stage multi-agent pipeline
    agent/memory.ts          # episodic/semantic/procedural memory
    agent/trace.ts           # provenance: runs + steps as graph nodes
    agent/actions.ts         # page / create / resolve (with provenance)
    agent/provider.ts        # OpenRouter / OpenAI-compatible model
  components/                # canvas, chat, trace, memory, analysis, cypher console
scripts/
  seed.ts                    # CLI seeder
  verify.ts                  # live smoke test: every query + the provenance chain
  mcp-server.ts              # standalone MCP (stdio) server
tests/                       # bun test — seed integrity, normalizers, Cypher builders, read-only guard
.github/workflows/
  ci.yml                     # typecheck + test + build on every push
  keepalive.yml              # keeps the free FalkorDB instance warm
  live-verify.yml            # weekly `bun run verify` against the real graph
vercel.json                  # framework + cron schedule
docs/
  ARCHITECTURE.md            # deep dive
  GRAPH-MODEL.md             # schema + Cypher cookbook
  DEMO-SCRIPT.md             # demo-video storyboard
  SUBMISSION.md              # submission checklist + track declarations
  BLOG-POST.md               # DEV.to draft (side prize)
```

## AI disclosure

This project was built with AI assistance (OpenCode). The graph model, Cypher, agent pipeline and UI were designed and verified by the author; the AI generated scaffolding and code that was reviewed, tested and edited. All data in the demo graph is synthetic.

## License

MIT — see [LICENSE](LICENSE).
