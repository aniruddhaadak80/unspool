import type { Graph } from "falkordb";
import { runCypher } from "@/lib/graph/falkordb";
import {
  ALERTS,
  DEPENDS_ON,
  DOCUMENTS,
  INCIDENTS,
  ONCALL,
  PROCEDURAL_MEMORY,
  SEMANTIC_MEMORY,
  SERVICES,
  TEAMS,
} from "@/lib/seed/company";

/**
 * Idempotent seed. Builds the whole synthetic company graph in one pass.
 * Safe to re-run: it wipes the target graph first (FalkorDB multigraph — each
 * tenant has its own, so this only clears the one tenant's graph).
 */
export async function seedGraph(graph: Graph, tenantId: string) {
  await graph.delete(); // fresh graph for this tenant
  const stats: Record<string, number> = {};

  const merge = async (cypher: string, params: Record<string, unknown> = {}) => {
    const r = await runCypher(graph, cypher, params);
    for (const [k, v] of Object.entries(r.stats)) stats[k] = (stats[k] ?? 0) + v;
    return r;
  };

  // ---- Teams & people ----
  for (const team of TEAMS) {
    await merge(`MERGE (:Team {name:$name})`, { name: team.name });
    for (const m of team.members) {
      await merge(
        `MERGE (p:Person {name:$name}) SET p.role=$role, p.timezone=$tz
         WITH p MATCH (t:Team {name:$team}) MERGE (p)-[:MEMBER_OF]->(t)`,
        { name: m.name, role: m.role, tz: m.timezone, team: team.name },
      );
    }
  }

  // ---- Services (with tier/lang/repo) + cluster ----
  for (const s of SERVICES) {
    await merge(
      `MERGE (sv:Service {name:$name})
       SET sv.tier=$tier, sv.language=$lang, sv.repo=$repo
       WITH sv MERGE (c:Cluster {name:$cluster}) MERGE (sv)-[:RUNS_IN]->(c)`,
      { name: s.name, tier: s.tier, lang: s.language, repo: s.repo, cluster: s.cluster },
    );
    // ownership: service -> its team
    await merge(
      `MATCH (sv:Service {name:$name}), (t:Team {name:$team})
       MERGE (sv)-[:OWNED_BY]->(t)`,
      { name: s.name, team: s.team },
    );
  }

  // ---- Dependencies (directed DEPENDS_ON) ----
  for (const [from, to, latency, critical] of DEPENDS_ON) {
    await merge(
      `MATCH (a:Service {name:$from}), (b:Service {name:$to})
       MERGE (a)-[:DEPENDS_ON {latencyMs:$latency, critical:$critical}]->(b)`,
      { from, to, latency, critical },
    );
  }

  // ---- On-call rosters ----
  for (const [service, person] of ONCALL) {
    await merge(
      `MATCH (p:Person {name:$person}), (s:Service {name:$service})
       MERGE (p)-[:ONCALL_FOR]->(s)`,
      { person, service },
    );
  }

  // ---- Documents (runbooks, ADRs, Slack, tickets, postmortems) ----
  for (const d of DOCUMENTS) {
    await merge(
      `MERGE (doc:Document {id:$id})
       SET doc.kind=$kind, doc.title=$title, doc.body=$body, doc.at=$at`,
      { id: d.id, kind: d.kind, title: d.title, body: d.body, at: d.at },
    );
    for (const ref of d.refs) {
      await merge(
        `MATCH (doc:Document {id:$id}), (s:Service {name:$ref})
         MERGE (doc)-[:REFERENCES]->(s)`,
        { id: d.id, ref },
      );
    }
  }

  // ---- Incidents + their alerts + affected services ----
  for (const inc of INCIDENTS) {
    await merge(
      `MERGE (i:Incident {id:$id})
       SET i.title=$title, i.severity=$sev, i.status=$status, i.openedAt=$openedAt`,
      { id: inc.id, title: inc.title, sev: inc.severity, status: inc.status, openedAt: inc.openedAt },
    );
    for (const svc of inc.affects) {
      await merge(
        `MATCH (i:Incident {id:$id}), (s:Service {name:$svc})
         MERGE (i)-[:AFFECTS]->(s)`,
        { id: inc.id, svc },
      );
    }
  }

  // ---- Alerts ----
  for (const a of ALERTS) {
    await merge(
      `MERGE (al:Alert {name:$name}) SET al.threshold=$threshold, al.window=$window`,
      { name: a.name, threshold: a.threshold, window: a.window },
    );
  }
  // wire alerts to the services they most plausibly watch
  await merge(
    `MATCH (al:Alert {name:'checkout-5xx-rate'}), (s:Service {name:'checkout-api'})
     MERGE (al)-[:FIRES_ON]->(s)`,
  );
  await merge(
    `MATCH (al:Alert {name:'ledger-write-p99'}), (s:Service {name:'ledger'})
     MERGE (al)-[:FIRES_ON]->(s)`,
  );
  await merge(
    `MATCH (al:Alert {name:'risk-engine-timeout'}), (s:Service {name:'risk-engine'})
     MERGE (al)-[:FIRES_ON]->(s)`,
  );

  // ---- Seed memory (semantic + procedural) ----
  for (const m of SEMANTIC_MEMORY) {
    await merge(
      `CREATE (mem:Memory {kind:'semantic', key:$key, value:$value, at:timestamp()})
       WITH mem MATCH (e {name:$about}) MERGE (mem)-[:ABOUT]->(e)`,
      { key: m.key, value: m.value, about: m.about },
    );
  }
  for (const m of PROCEDURAL_MEMORY) {
    await merge(
      `CREATE (mem:Memory {kind:'procedural', key:$key, value:$value, at:timestamp()})
       WITH mem MATCH (e {name:$about}) MERGE (mem)-[:ABOUT]->(e)`,
      { key: m.key, value: m.value, about: m.about },
    );
  }

  // ---- Tenant marker ----
  await merge(`MERGE (t:Tenant {id:$id}) SET t.seededAt=timestamp()`, { id: tenantId });

  // ---- Indexes for the hot lookups ----
  for (const [label, prop] of [
    ["Service", "name"],
    ["Person", "name"],
    ["Team", "name"],
    ["Document", "id"],
    ["Incident", "id"],
    ["Memory", "kind"],
  ] as const) {
    try {
      await graph.createNodeRangeIndex(label, prop);
    } catch {
      /* index may already exist — fine */
    }
  }

  return { tenantId, stats, seededAt: Date.now() };
}

/** Count nodes/relationships/labels for the UI's "graph is live" badge. */
export async function graphStats(graph: Graph) {
  const { rows } = await runCypher<{ nodes: number; rels: number }>(
    graph,
    `MATCH (n) WITH count(n) AS nodes
     MATCH ()-[r]->() WITH nodes, count(r) AS rels
     RETURN nodes, rels`,
  );
  const { rows: labelRows } = await runCypher<{ label: string; c: number }>(
    graph,
    `MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS c ORDER BY c DESC`,
  );
  return { nodes: rows[0]?.nodes ?? 0, rels: rows[0]?.rels ?? 0, labels: labelRows };
}
