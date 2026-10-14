# Graph data model & Cypher cookbook

Everything below is the contract between the seed data (`src/lib/seed/company.ts`),
the agent's tools (`src/lib/agent/registry.ts`), and the replay UI.

## Labels & properties

| Label | Properties | Notes |
|---|---|---|
| `Service` | `name, tier(1-3), language, repo` | `tier` = criticality |
| `Team` | `name` | |
| `Person` | `name, role, timezone` | |
| `Document` | `id, kind, title, body, at` | kind ∈ runbook, adr, slack, ticket, postmortem |
| `Incident` | `id, title, severity(1-4), status, openedAt, resolution?` | |
| `Alert` | `name, threshold, window` | |
| `Memory` | `kind, key, value, at` | kind ∈ episodic, semantic, procedural |
| `AgentRun` | `id, agent, prompt, startedAt, answer?, finishedAt?` | one reasoning run |
| `TraceStep` | `idx, kind, summary, cypher?, detail?, at` | one step in a run |
| `Action` | `kind, at, reason, severity` | page / create / resolve |
| `Decision` | `id, kind, rationale, severity?, at` | provenance chain — what authorized an action |
| `Evidence` | `ref, kind, at` | a graph fact a decision was BASED_ON |
| `Cluster` | `name` | deployment cluster |
| `Tenant` | `id, seededAt` | tenant marker |

## Relationship types

| Type | From → To | Properties |
|---|---|---|
| `DEPENDS_ON` | Service → Service | `latencyMs, critical` |
| `OWNED_BY` | Service → Team | |
| `HAS_MEMBER` | Team → Person | |
| `ONCALL_FOR` | Person → Service | |
| `AUTHORED` | Person → Document | |
| `REFERENCES` | Document → Service | |
| `AFFECTS` | Incident → Service | |
| `FIRES_ON` | Alert → Service | |
| `ABOUT` | Memory → (Service\|Person\|Incident\|Team) | |
| `TOOK_STEP` | AgentRun → TraceStep | |
| `TOUCHES` | TraceStep → (any entity) | |
| `TARGETS` | Action → Incident | |
| `AUTHORIZED_BY` | Action → Decision | |
| `BASED_ON` | Decision → Evidence | |
| `RUNS_IN` | Service → Cluster | |
| `MEMBER_OF` | Person → Team | |

## The queries the product depends on

### 1. Blast radius — "what breaks if X goes down?"

```cypher
MATCH p = (s:Service {name:'checkout-api'})-[:DEPENDS_ON*1..3]->(dep:Service)
RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth
ORDER BY depth
```

### 2. Upstream dependents — "who calls X?"

```cypher
MATCH p = (dep:Service)-[:DEPENDS_ON*1..3]->(s:Service {name:'ledger'})
RETURN [n IN nodes(p) | n.name] AS names, length(p) AS depth
ORDER BY depth
```

### 3. Graph algorithms as agent tools

```cypher
CALL algo.pageRank('Service','DEPENDS_ON') YIELD node, score
RETURN node, score ORDER BY score DESC LIMIT 25;

CALL algo.WCC('Service','DEPENDS_ON') YIELD node, setId RETURN node, setId;
CALL algo.CDLP('Service','DEPENDS_ON') YIELD node, community RETURN node, community;
CALL algo.betweennessCentrality('Service','DEPENDS_ON') YIELD node, score
RETURN node, score ORDER BY score DESC LIMIT 25;
```

### 4. The "red thread" — shortest reasoning path

```cypher
MATCH (a {name:'checkout-api'}), (b {name:'ledger'})
WITH a, b, shortestPath((a)-[*]-(b)) AS sp
RETURN sp, length(sp) AS len
```

### 5. Ownership & on-call — "who do I page?"

```cypher
MATCH (s:Service {name:'payments-gateway'})
OPTIONAL MATCH (s)-[:OWNED_BY]->(t:Team)
OPTIONAL MATCH (t)-[:HAS_MEMBER]->(m:Person)
OPTIONAL MATCH (p:Person)-[:ONCALL_FOR]->(s)
RETURN s, t, collect(DISTINCT m) AS members, collect(DISTINCT p) AS oncall
```

### 6. Cross-session memory recall

```cypher
MATCH (m:Memory)
WHERE m.kind = 'semantic'
OPTIONAL MATCH (m)-[:ABOUT]->(a)
WITH m, collect(coalesce(a.name, a.id)) AS aboutNames
WHERE 'ledger' IN aboutNames
RETURN m ORDER BY m.at DESC LIMIT 20
```

### 7. Writing the trace (every step becomes a graph node)

```cypher
MATCH (r:AgentRun {id:$runId})
CREATE (s:TraceStep {idx:$idx, kind:'query_graph', summary:$summary, cypher:$cypher})
CREATE (r)-[:TOOK_STEP]->(s)
WITH s
UNWIND $touches AS name
MATCH (e) WHERE e.name = name OR e.id = name
MERGE (s)-[:TOUCHES]->(e)
```

### 8. Acting with provenance

A page never happens without a recorded decision. The action, the decision that
authorized it, and the evidence it was based on are all written in one step:

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

### 9. "Why was Priya paged?" — the justification, in one match

```cypher
MATCH (a:Action {kind:'page'})-[:AUTHORIZED_BY]->(d:Decision)-[:BASED_ON]->(ev:Evidence)-[:ABOUT]->(e)
RETURN d.rationale AS why, collect(DISTINCT coalesce(e.name, e.id)) AS evidence
```

### 10. Reading a full run trace (powers the replay UI)

```cypher
MATCH (r:AgentRun {id:$runId})-[:TOOK_STEP]->(s:TraceStep)
OPTIONAL MATCH (s)-[:TOUCHES]->(e)
WITH s, e ORDER BY s.idx
RETURN s, collect(e.name) AS touched
```

## Indexes

Range indexes on `Service(name)`, `Person(name)`, `Team(name)`, `Document(id)`,
`Incident(id)`, `Memory(kind)` — created idempotently by the seeder.
