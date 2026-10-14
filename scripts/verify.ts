#!/usr/bin/env bun
/**
 * Live verification against a real FalkorDB.
 *
 *   bun run verify
 *
 * This is the project's end-to-end smoke test. Unit tests (`bun test`) run
 * without a database and prove the pure logic; this proves the *Cypher* — that
 * every query the product depends on actually parses and returns the rows the
 * agent expects, against a real FalkorDB instance.
 *
 * It seeds a throwaway `verify` tenant (leaving the demo graph untouched), runs
 * every graph query, runs the full replay agent, then asserts the provenance
 * chain (Action → Decision → Evidence) really exists in the graph. Exit code is
 * non-zero on any failure, so it works as a pre-submission gate.
 */
import {
  connectionConfig,
  isFalkorConfigured,
  runCypher,
  selectGraph,
} from "../src/lib/graph/falkordb";
import { graphStats, seedGraph } from "../src/lib/graph/seed";
import {
  blastRadius,
  dependentsOf,
  documentsFor,
  findEntities,
  getServiceOwnership,
  memories,
  pastIncidents,
  runAlgorithm,
  shortestPathBetween,
  subgraphAround,
} from "../src/lib/graph/queries";
import { recall } from "../src/lib/agent/memory";
import { runAgent } from "../src/lib/agent/orchestrator";

const TENANT = "verify";

// Deterministic: exercise the graph-replay agent, never the paid LLM path.
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AGENT_API_KEY;

type CheckResult = boolean | { ok: boolean; note?: string };
let passed = 0;
let failed = 0;
const rows: Array<{ name: string; ok: boolean; ms: number; note: string }> = [];

async function check(name: string, fn: () => CheckResult | Promise<CheckResult>): Promise<void> {
  const t0 = performance.now();
  let ok = false;
  let note = "";
  try {
    const r = await fn();
    ok = typeof r === "boolean" ? r : r.ok;
    note = typeof r === "boolean" ? "" : (r.note ?? "");
  } catch (err) {
    ok = false;
    note = `threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ms = Math.round(performance.now() - t0);
  rows.push({ name, ok, ms, note });
  ok ? passed++ : failed++;
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${name} \x1b[2m(${ms}ms)\x1b[0m${note ? `\n      \x1b[2m${note}\x1b[0m` : ""}`);
}

function bail(msg: string): never {
  console.error(`\n\x1b[31m${msg}\x1b[0m\n`);
  process.exit(1);
}

console.log("\n\x1b[1mUnspool — live graph verification\x1b[0m\n");

if (!isFalkorConfigured()) {
  console.log("  FalkorDB is \x1b[33mnot configured\x1b[0m.");
  console.log("  1. Create a free instance: https://app.falkordb.cloud/signup");
  console.log("  2. Put the connection string in .env.local as FALKORDB_URL=...");
  console.log("  3. Re-run: bun run verify\n");
  process.exit(1);
}

const cfg = connectionConfig();
// Print the target with credentials redacted — never echo the password.
const target = cfg.url
  ? cfg.url.replace(/\/\/[^@]*@/, "//***@")
  : `${cfg.host ?? "localhost"}:${cfg.port}`;
console.log(`  target: \x1b[2m${target}\x1b[0m  (tenant "${TENANT}")\n`);

const graph = await selectGraph(TENANT);

console.log("\x1b[1mseed\x1b[0m");
await check("seedGraph builds the synthetic company", async () => {
  await seedGraph(graph, TENANT);
  const stats = await graphStats(graph);
  return {
    ok: stats.nodes > 20 && stats.rels > 20,
    note: `${stats.nodes} nodes · ${stats.rels} relationships · ${stats.labels.length} labels`,
  };
});

console.log("\n\x1b[1mgraph queries (the Cypher the product depends on)\x1b[0m");

await check("findEntities: keyword search", async () => {
  const n = await findEntities(graph, "ledger");
  return { ok: n.length > 0, note: `${n.length} hits for “ledger”` };
});

await check("getServiceOwnership: team + roster + on-call", async () => {
  const o = (await getServiceOwnership(graph, "risk-engine")) as {
    team?: { properties?: { name?: string } };
    oncall?: unknown[];
  } | null;
  const team = o?.team?.properties?.name;
  return {
    ok: Boolean(team) && (o?.oncall?.length ?? 0) > 0,
    note: `owner=${team ?? "?"} · on-call=${o?.oncall?.length ?? 0}`,
  };
});

await check("blastRadius: 3 hops downstream of checkout-api", async () => {
  const paths = await blastRadius(graph, "checkout-api", 3);
  const names = paths.flatMap((p) => p.names);
  return {
    ok: paths.length > 0 && names.includes("payments-gateway"),
    note: `${paths.length} paths · reaches payments-gateway=${names.includes("payments-gateway")}`,
  };
});

await check("dependentsOf: upstream callers of ledger", async () => {
  const paths = await dependentsOf(graph, "ledger", 3);
  const names = paths.flatMap((p) => p.names);
  return {
    ok: paths.length > 0 && names.includes("checkout-api"),
    note: `${paths.length} paths · reaches checkout-api=${names.includes("checkout-api")}`,
  };
});

await check("shortestPathBetween: checkout-api ⇄ ledger", async () => {
  const p = await shortestPathBetween(graph, "checkout-api", "ledger");
  return { ok: Boolean(p && p.len > 0), note: p ? `${p.nodes.join(" → ")}` : "no path" };
});

await check("documentsFor: runbooks/ADRs for ledger", async () => {
  const docs = await documentsFor(graph, "ledger");
  const ids = docs.map((d) => d.properties?.id as string).filter(Boolean);
  return { ok: docs.length > 0, note: ids.join(", ") || `${docs.length} docs` };
});

await check("pastIncidents: episodic recall for ledger", async () => {
  const inc = await pastIncidents(graph, "ledger");
  const ids = inc.map((i) => i.properties?.id as string).filter(Boolean);
  return { ok: inc.length > 0, note: ids.join(", ") || `${inc.length} incidents` };
});

await check("subgraphAround: canvas neighborhood of checkout-api", async () => {
  const sub = await subgraphAround(graph, "checkout-api", 2);
  return { ok: sub.nodes.length > 1 && sub.edges.length > 0, note: `${sub.nodes.length} nodes · ${sub.edges.length} edges` };
});

await check("recall: memory about checkout-api", async () => {
  const m = await recall(graph, { about: "checkout-api" });
  return { ok: Array.isArray(m) && m.length > 0, note: `${m.length} memories` };
});

await check("memories: procedural rules", async () => {
  const m = await memories(graph, "procedural");
  return { ok: m.length > 0, note: `${m.length} procedural memories` };
});

console.log("\n\x1b[1mgraph algorithms (FalkorDB's algo.* engine)\x1b[0m");
for (const algo of ["pageRank", "wcc", "cdlp", "betweennessCentrality"] as const) {
  await check(`algo.${algo} over Service/DEPENDS_ON`, async () => {
    const r = await runAlgorithm(graph, algo, "Service", "DEPENDS_ON");
    const firstName =
      (r.rows[0]?.node as { properties?: { name?: string } })?.properties?.name ?? "?";
    return { ok: r.rows.length > 0, note: `${r.rows.length} ranked nodes · top=${firstName}` };
  });
}

console.log("\n\x1b[1mthe agent's action + provenance loop\x1b[0m");

let answer = "";
await check("runAgent (replay): pages on-call and answers", async () => {
  const out = await runAgent({
    tenantId: TENANT,
    question: "Why is checkout failing, and who should I page?",
  });
  answer = out.answer;
  return {
    ok: out.acted && out.steps.length > 0 && out.answer.length > 0,
    note: `${out.steps.length} trace steps · live=${out.live}`,
  };
});

await check("the page reuses the seeded open incident (INC-2041)", () => {
  const ok = answer.includes("INC-2041");
  return { ok, note: ok ? "incident INC-2041 linked" : "expected INC-2041 in the answer" };
});

await check("incident id is never 'unknown'", () => ({
  ok: !answer.includes("unknown"),
  note: answer.includes("unknown") ? "answer contained 'unknown'" : "real id",
}));

await check("provenance: Action → Decision → Evidence → entity", async () => {
  const { rows: r } = await runCypher<{ decision: string; evidence: string[] }>(
    graph,
    `MATCH (a:Action {kind:'page'})-[:AUTHORIZED_BY]->(d:Decision)-[:BASED_ON]->(ev:Evidence)-[:ABOUT]->(e)
     RETURN d.id AS decision, collect(DISTINCT coalesce(e.name, e.id)) AS evidence`,
  );
  const evidence = r[0]?.evidence ?? [];
  return {
    ok: r.length > 0 && evidence.includes("ledger"),
    note: r.length ? `evidence: ${evidence.join(", ")}` : "no provenance chain found",
  };
});

await check("memory links to the incident it is about", async () => {
  const { rows: r } = await runCypher<{ c: number }>(
    graph,
    `MATCH (m:Memory)-[:ABOUT]->(i:Incident) RETURN count(m) AS c`,
  );
  return { ok: (r[0]?.c ?? 0) > 0, note: `${r[0]?.c ?? 0} memories linked to incidents` };
});

await check('the README query "why was Priya paged?" answers', async () => {
  const { rows: r } = await runCypher<{ reason: string; decision: string; evidence: string[] }>(
    graph,
    `MATCH (a:Action {kind:'page'})-[:AUTHORIZED_BY]->(d:Decision)-[:BASED_ON]->(ev:Evidence)
     RETURN a.reason AS reason, d.id AS decision, collect(ev.ref) AS evidence
     ORDER BY a.at DESC LIMIT 1`,
  );
  const top = r[0];
  return {
    ok: Boolean(top) && Array.isArray(top?.evidence) && top!.evidence.length > 0,
    note: top ? `${top.decision} · ${top.evidence.length} evidence nodes` : "no page recorded",
  };
});

console.log("\n\x1b[1mtrace replay\x1b[0m");
await check("trace steps are graph nodes linked to the run", async () => {
  const { rows: r } = await runCypher<{ c: number }>(
    graph,
    `MATCH (:AgentRun)-[:TOOK_STEP]->(s:TraceStep) RETURN count(s) AS c`,
  );
  return { ok: (r[0]?.c ?? 0) > 0, note: `${r[0]?.c ?? 0} trace steps` };
});

const total = passed + failed;
console.log(
  `\n\x1b[1m${failed === 0 ? "\x1b[32mPASS" : "\x1b[31mFAIL"}\x1b[0m \x1b[1m${passed}/${total}\x1b[0m checks` +
    ` \x1b[2m(${rows.reduce((a, b) => a + b.ms, 0)}ms total)\x1b[0m\n`,
);

if (failed > 0) {
  console.log("\x1b[31mFailed checks:\x1b[0m");
  for (const r of rows.filter((r) => !r.ok)) {
    console.log(`  • ${r.name}${r.note ? ` — ${r.note}` : ""}`);
  }
  console.log();
  process.exit(1);
}
process.exit(0);
