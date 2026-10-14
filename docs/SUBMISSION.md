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
