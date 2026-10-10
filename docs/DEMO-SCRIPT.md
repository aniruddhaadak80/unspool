# Demo video storyboard (~3 minutes)

Goal: a judge watching this video understands **(a)** what the agent does, **(b)**
that FalkorDB is load-bearing, **(c)** that every answer is traceable. Record after
the live deploy is up.

## 0:00–0:15 — Hook

Show the UI cold: three-panel mission control (command channel · company graph ·
reasoning trace + memory). Say it once, plainly:

> "This is Unspool — an incident-response agent whose entire context lives in a
> FalkorDB graph. Every answer it gives is traceable, hop by hop, in the graph."

## 0:15–0:40 — The world is a graph

Screen: the canvas, seeded with acme's synthetic company. Pan/zoom slowly.
Point out node colors: services, teams, people, documents, incidents, memory.

> "Twelve services connected by DEPENDS_ON. Teams, on-call rosters, runbooks,
> ADRs, past incidents — and the agent's own memory. All one graph, one hop from
> any question."

## 0:40–1:40 — Run 1: "Why is checkout failing, and who should I page?"

Type the question. While it runs, **watch the canvas and trace fill in**:

1. `read_memory` — recalls the cascade pattern (ledger → risk-engine → payments-gateway → checkout).
2. `query_graph` — blast radius, 3 hops from checkout-api. Nodes light up.
3. `algorithm` — PageRank over Service/DEPENDS_ON; ledger + payments-gateway rank highest.
4. `read_memory` — past incident on ledger (INC-1180).
5. `act` — **pages Priya Nair**, opens INC-2041 in the graph.

Land the explainability line while the trace replays:

> "Every step — the Cypher, the PageRank, the recall, the page — is a node in the
> graph. I can replay the answer, and so can an auditor, with one Cypher query."

## 1:40–2:10 — Run 2: "What breaks if the ledger goes down?"

Watch the blast-radius walk and shortest-path highlight. Show the answer's
`[bracketed]` sources. Quick note:

> "Multi-hop reasoning is one traversal, not a join across five systems."

## 2:10–2:35 — Multi-agent + memory

Point at the trace timeline header (triage → investigator → commander stages),
then the memory panel with episodic/semantic/procedural tabs showing the writes
that just landed.

> "Triage recalls, the investigator gathers evidence, the commander decides and
> acts — they share state through the graph, not through memory. And everything
> they learn persists, so the next session starts warm."

## 2:35–2:50 — Removal test + MCP

> "Take FalkorDB out and there is no product: no answers, no memory, no trace.
> The same tools are exposed over MCP — any MCP client can drive this graph."

Optional 5-second insert: `bun run mcp` starting, tools listing in Claude Desktop.

## 2:50–3:00 — Close

> "Unspool — incident command that shows its work. Built on FalkorDB."

---

## Recording checklist

- [ ] Live deploy URL open and healthy (green badges: falkordb · model)
- [ ] Graph seeded (click **re-seed graph** before recording)
- [ ] Ask question 1, let the full trace replay finish on screen
- [ ] Ask question 2, show the shortest-path highlight
- [ ] End on the memory panel with fresh episodic writes visible
- [ ] Audio: single clear voiceover, no background music
- [ ] Export 1080p, MP4, < 100MB
