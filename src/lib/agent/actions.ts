import { randomUUID } from "node:crypto";
import type { Graph } from "falkordb";
import { runCypher } from "@/lib/graph/falkordb";
import { writeMemory } from "@/lib/agent/memory";

/**
 * Where the agent ACTS on the world (Track 1). Every action is written back
 * into the same FalkorDB graph as an (:Action) node, tied to the incident it
 * serves and to the (:Decision) that authorized it — which is itself tied to
 * the (:Evidence) it was BASED_ON. That closes the loop: the act and its
 * justification live side by side, so an auditor answers "why was X paged?"
 * with one Cypher match instead of grepping logs.
 *
 * In a real deployment these would fan out to PagerDuty / Opsgenie / Slack.
 * Here they are simulated but fully recorded, so the reasoning loop is real.
 */

/**
 * Provenance (Action → Decision → Evidence) is enrichment: if a write fails we
 * must still page the human. The failure is surfaced as `provenanceRecorded:
 * false` and logged, never by throwing out of the agent loop.
 */
export interface PageResult {
  paged: string;
  service: string;
  incidentId: string;
  reason: string;
  at: number;
  decisionId: string;
  provenanceRecorded: boolean;
}

function newIncidentId(): string {
  return `INC-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export async function actPageOnCall(
  graph: Graph,
  input: {
    service: string;
    reason: string;
    severity: number;
    /** Entity names/ids the decision was based on → (:Evidence). */
    evidence?: string[];
  },
): Promise<PageResult> {
  const { service, reason, severity } = input;

  // 1. Who is on call for this service — the owner team's member flagged
  //    ONCALL_FOR on this exact service.
  const oncall = await runCypher<{ paged: string }>(
    graph,
    `MATCH (s:Service {name:$service})-[:OWNED_BY]->(:Team)-[:HAS_MEMBER]->(p:Person)-[:ONCALL_FOR]->(s)
     RETURN p.name AS paged LIMIT 1`,
    { service },
  );
  const paged = oncall.rows[0]?.paged ?? "unassigned";

  // 2. Attach the page to the incident it serves: the open incident that
  //    already AFFECTS this service (the seeded INC-2041 does), otherwise open
  //    a fresh one with a real id — never a null one.
  const open = await runCypher<{ id: string }>(
    graph,
    `MATCH (i:Incident {status:'open'})-[:AFFECTS]->(:Service {name:$service})
     RETURN i.id AS id ORDER BY i.openedAt DESC LIMIT 1`,
    { service },
  );
  let incidentId = open.rows[0]?.id ?? "";
  if (!incidentId) {
    incidentId = newIncidentId();
    await runCypher(
      graph,
      `CREATE (i:Incident {id:$id, title:$title, severity:$severity, status:'open', openedAt:timestamp()})
       WITH i
       MATCH (s:Service {name:$service})
       MERGE (i)-[:AFFECTS]->(s)`,
      { id: incidentId, title: `Auto-opened: ${service}`, severity, service },
    );
  }
  // Escalate the incident (never de-escalate) to the paged severity.
  await runCypher(
    graph,
    `MATCH (i:Incident {id:$id})
     SET i.severity = CASE WHEN i.severity IS NULL OR $severity < i.severity
                           THEN $severity ELSE i.severity END`,
    { id: incidentId, severity },
  );

  // 3. Record the ACTION and the DECISION that authorized it, in the graph.
  const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let at = Date.now();
  let provenanceRecorded = false;
  try {
    const { rows } = await runCypher<{ at: number }>(
      graph,
      `MATCH (i:Incident {id:$incidentId})
       CREATE (a:Action {kind:'page', at:timestamp(), reason:$reason, severity:$severity})
       CREATE (d:Decision {id:$decisionId, kind:'page', rationale:$reason, severity:$severity, at:timestamp()})
       CREATE (a)-[:AUTHORIZED_BY]->(d)
       CREATE (a)-[:TARGETS]->(i)
       RETURN a.at AS at`,
      { incidentId, decisionId, reason, severity },
    );
    at = Number(rows[0]?.at ?? at);
    provenanceRecorded = true;

    // 4. The evidence the decision was based on — each fact becomes an
    //    (:Evidence) node pointing back at the real entity it came from.
    const evidence = (input.evidence ?? []).map((e) => e.trim()).filter(Boolean);
    if (evidence.length) {
      await runCypher(
        graph,
        `MATCH (d:Decision {id:$decisionId})
         UNWIND $evidence AS ref
         MATCH (e) WHERE e.name = ref OR e.id = ref
         MERGE (ev:Evidence {ref: ref})
           ON CREATE SET ev.kind='entity', ev.at=timestamp()
         MERGE (d)-[:BASED_ON]->(ev)
         MERGE (ev)-[:ABOUT]->(e)`,
        { decisionId, evidence },
      );
    }
  } catch (err) {
    console.warn("[unspool] provenance write failed (action still recorded):", err);
  }

  // Episodic memory: remember that we paged someone and why.
  await writeMemory(graph, {
    kind: "episodic",
    key: `page:${service}:${Date.now()}`,
    value: `Paged ${paged} for ${service} (SEV${severity}). Reason: ${reason}`,
    about: [service, incidentId],
  });

  return {
    paged,
    service,
    incidentId,
    reason,
    at,
    decisionId,
    provenanceRecorded,
  };
}

export async function actCreateIncident(
  graph: Graph,
  input: { title: string; severity: number; services: string[] },
) {
  const id = newIncidentId();
  await runCypher<{ id: string }>(
    graph,
    `CREATE (i:Incident {id:$id, title:$title, severity:$severity, status:'open', openedAt:timestamp()})
     WITH i
     UNWIND $services AS name
     MATCH (s:Service {name:name})
     MERGE (i)-[:AFFECTS]->(s)
     RETURN i.id AS id`,
    { id, title: input.title, severity: input.severity, services: input.services },
  );
  await writeMemory(graph, {
    kind: "episodic",
    key: `incident:${id}`,
    value: `Opened incident ${id} “${input.title}” (SEV${input.severity}) affecting ${input.services.join(", ")}`,
    about: [...input.services, id],
  });
  return { incidentId: id, title: input.title, services: input.services };
}

export async function actResolveIncident(
  graph: Graph,
  input: { id: string; resolution: string },
) {
  await runCypher(
    graph,
    `MATCH (i:Incident) WHERE i.id = $id
     SET i.status='resolved', i.resolvedAt=timestamp(), i.resolution=$resolution
     RETURN i.id AS id`,
    { id: input.id, resolution: input.resolution },
  );
  await writeMemory(graph, {
    kind: "episodic",
    key: `resolve:${input.id}:${Date.now()}`,
    value: `Resolved ${input.id}. Resolution: ${input.resolution}`,
    about: [input.id],
  });
  return { incidentId: input.id, status: "resolved" };
}
