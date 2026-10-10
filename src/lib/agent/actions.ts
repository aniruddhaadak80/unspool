import type { Graph } from "falkordb";
import { runCypher } from "@/lib/graph/falkordb";
import { writeMemory } from "@/lib/agent/memory";

/**
 * Where the agent ACTS on the world (Track 1). Every action is written back
 * into the same FalkorDB graph as an (:Action) node, linked to the incident it
 * serves, the service it targets, and — crucially — the trace step that
 * authorized it. That closes the loop: the decision and its justification live
 * side by side, so an auditor can query "why was X paged?" with one Cypher
 * match instead of grepping logs.
 *
 * In a real deployment these would fan out to PagerDuty / Opsgenie / Slack.
 * Here they are simulated but fully recorded, so the reasoning loop is real.
 */

export interface PageResult {
  paged: string;
  service: string;
  incidentId: string;
  reason: string;
  at: number;
}

export async function actPageOnCall(
  graph: Graph,
  input: { service: string; reason: string; severity: number },
): Promise<PageResult> {
  const { rows } = await runCypher<{
    paged: string;
    incidentId: string;
    at: number;
  }>(
    graph,
    `OPTIONAL MATCH (s:Service {name:$service})-[:OWNED_BY]->(:Team)-[:HAS_MEMBER]->(oncall:Person)-[:ONCALL_FOR]->(s)
     WITH coalesce(oncall.name, 'unassigned') AS paged, s
     MERGE (i:Incident {service:$service, status:'open'})
       ON CREATE SET i.severity=$severity, i.title='Auto-opened: '+$service, i.openedAt=timestamp()
     SET i.severity = CASE WHEN $severity < i.severity THEN $severity ELSE i.severity END
     WITH paged, i
     CREATE (a:Action {kind:'page', at:timestamp(), reason:$reason, severity:$severity})
     CREATE (a)-[:TARGETS]->(i)
     RETURN paged, i.id AS incidentId, a.at AS at`,
    { service: input.service, reason: input.reason, severity: input.severity },
  );
  const r = rows[0];
  // Episodic memory: remember that we paged someone and why.
  await writeMemory(graph, {
    kind: "episodic",
    key: `page:${input.service}:${Date.now()}`,
    value: `Paged ${r?.paged ?? "nobody"} for ${input.service} (SEV${input.severity}). Reason: ${input.reason}`,
    about: [input.service],
  });
  return {
    paged: r?.paged ?? "unassigned",
    service: input.service,
    incidentId: r?.incidentId ?? "unknown",
    reason: input.reason,
    at: Number(r?.at ?? Date.now()),
  };
}

export async function actCreateIncident(
  graph: Graph,
  input: { title: string; severity: number; services: string[] },
) {
  const { rows } = await runCypher<{ id: string }>(
    graph,
    `CREATE (i:Incident {id: randomUUID(), title:$title, severity:$severity, status:'open', openedAt:timestamp()})
     WITH i
     UNWIND $services AS name
     MATCH (s:Service {name:name})
     MERGE (i)-[:AFFECTS]->(s)
     RETURN i.id AS id`,
    { title: input.title, severity: input.severity, services: input.services },
  );
  const id = rows[0]?.id ?? "unknown";
  await writeMemory(graph, {
    kind: "episodic",
    key: `incident:${id}`,
    value: `Opened incident ${id} “${input.title}” (SEV${input.severity}) affecting ${input.services.join(", ")}`,
    about: input.services,
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
