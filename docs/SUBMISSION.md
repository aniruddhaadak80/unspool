# Submission checklist — Graph Hacks (WeMakeDevs × FalkorDB)

Deadline: **Oct 18, 2026, 11:59 PM IST**. Register + submit at
<https://www.wemakedevs.org/hackathons/falkordb> (submissions via the same panel).

## Required by the rules

- [x] **Public source-code repository** — `github.com/aniruddhaadak80/unspool`
- [x] **README with setup instructions and graph data model** — `README.md` + `docs/GRAPH-MODEL.md`
- [x] **The Cypher queries / graph algorithms the product depends on** — README "The Cypher the product depends on" + `docs/GRAPH-MODEL.md`
- [ ] **Demo video showing the working project** — record following `docs/DEMO-SCRIPT.md` (3 min)
- [x] **Live deployment** — Vercel: <https://unspool-red.vercel.app> + full local setup in README
- [ ] **The track you are entering** — declare: **all three tracks**
      1. Agents That Act on Connected Data
      2. Agent Memory and Coordination
      3. Company Brain

## Pre-submit verification

- [x] `bun run typecheck` clean (runs `next typegen` first)
- [x] `bun test` green (35 tests) and `bun run build` clean
- [x] CI green on `main` (`.github/workflows/ci.yml`) — typecheck + test + build
- [ ] `bun run verify` green against a live graph (seeds a `verify` tenant, runs every
      query + the full replay agent, asserts the Action → Decision → Evidence chain)
- [ ] `bun run seed` + `bun run start` → full replay works locally
- [ ] Live deploy: `/api/health` shows `falkordb: ok`
- [ ] Live deploy: ask "Why is checkout failing, and who should I page?" → agent pages on-call, trace replays
- [ ] Live deploy: tenant switch works (isolated graphs)
- [x] Live deploy: `POST /api/cypher` with `CREATE …` returns 403 (read-only guard)
- [x] Live deploy: analysis + cypher-console drawer render under the canvas
- [x] **Keep-alive wired** — `/api/cron/keepalive` + Vercel Cron (2×/day) + `.github/workflows/keepalive.yml` (every 6h) touch FalkorDB and auto-re-seed any empty tenant, so the free instance never idles out during judging
- [ ] Confirm the free instance is up and seeded right before submitting (`GET /api/health` → `falkordb: ok`)
- [ ] Repo has: README, LICENSE, topics, About description, `.env.example`

## Side prize: Best blog post (AirPods 5)

Draft ready at `docs/BLOG-POST.md` (DEV.to front matter included). Publish after the
demo video exists, then link it in the submission form.

## Honesty gates

- [x] Synthetic data only (no private/paywalled/personal data in the graph)
- [x] AI assistance disclosed (README + blog post)
- [x] Can explain: graph model, every Cypher query, the 3-stage pipeline, why FalkorDB is load-bearing — rehearse from `docs/ARCHITECTURE.md`

## Copy-paste submission form

**Project name:** Unspool

**Tagline (≤ 100 chars):**
> Incident command that shows its work — a graph-native agent on FalkorDB.

**Short description:**
> Unspool is an incident-response agent whose entire reasoning process is graph
> data. Every Cypher query, graph algorithm, memory recall, decision and action
> it takes is written back into FalkorDB as nodes and edges, then replayed on a
> live company graph — hop by hop — so an operator can see exactly why it paged
> someone. It runs a 3-stage agent pipeline (triage → investigator → commander)
> over a connected company brain of services, dependencies, teams, on-call
> rosters, runbooks, ADRs and past incidents, with episodic/semantic/procedural
> memory stored as graph nodes. PageRank, WCC and betweenness centrality are
> ordinary agent tools. `POST /api/cypher` lets anyone run the README's queries
> live; `GET /api/analysis` shows the graph's structural X-ray.

**Tracks (select all three):**
1. Agents That Act on Connected Data
2. Agent Memory and Coordination
3. Company Brain

**Live demo:** https://unspool-red.vercel.app
**Repo:** https://github.com/aniruddhaadak80/unspool
**Video:** _(paste the demo-video link)_

**Built with:** Next.js 16 · React 19 · TypeScript (strict) · FalkorDB ·
`falkordb` Node client · `algo.*` graph algorithms · AI SDK v7 · OpenRouter ·
React Flow · Tailwind 4 · Bun

**AI disclosure:**
> Built with heavy AI assistance (an AI coding agent wrote most of the code
> under my direction). All data in the graph is synthetic and invented. Without
> an LLM key the app runs a deterministic graph-replay agent that still executes
> real Cypher, real graph algorithms and real graph writes.
