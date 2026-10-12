/**
 * Seed-data integrity tests. These guard the single most important non-code
 * fact of the demo: every edge ships to a service/person/team that actually
 * exists. A typo here is invisible in the seed and silently breaks agent
 * answers on the live deploy, so we lock the data model down with tests.
 */
import { describe, expect, test } from "bun:test";
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
} from "../src/lib/seed/company";

const serviceNames = new Set(SERVICES.map((s) => s.name));
const teamNames = new Set(TEAMS.map((t) => t.name));
const personNames = new Set(TEAMS.flatMap((t) => t.members.map((m) => m.name)));
const docIds = new Set(DOCUMENTS.map((d) => d.id));
const incidentIds = new Set(INCIDENTS.map((i) => i.id));
const alertNames = new Set(ALERTS.map((a) => a.name));

/** Entity names a Memory node may point at via [:ABOUT]. */
const memoryTargets = new Set([
  ...serviceNames,
  ...teamNames,
  ...personNames,
  ...docIds,
  ...incidentIds,
]);

const DOC_KINDS = ["runbook", "adr", "slack", "ticket", "postmortem"];

function assertUnique<T>(items: T[], label: string) {
  const seen = new Set<string>();
  for (const it of items) {
    const key = JSON.stringify(it);
    expect(seen.has(key), `${label} duplicated: ${key}`).toBe(false);
    seen.add(key);
  }
}

describe("services", () => {
  test("names are unique and non-empty", () => {
    assertUnique(SERVICES.map((s) => s.name), "service name");
    for (const s of SERVICES) expect(s.name.length).toBeGreaterThan(0);
  });

  test("every service belongs to a seeded team", () => {
    for (const s of SERVICES) {
      expect(teamNames.has(s.team), `${s.name} → missing team ${s.team}`).toBe(true);
    }
  });
});

describe("dependencies (DEPENDS_ON)", () => {
  test("every source and target is a seeded service", () => {
    for (const [from, to] of DEPENDS_ON) {
      expect(serviceNames.has(from), `missing source ${from}`).toBe(true);
      expect(serviceNames.has(to), `missing target ${to}`).toBe(true);
    }
  });

  test("no service depends on itself", () => {
    for (const [from, to] of DEPENDS_ON) expect(from).not.toBe(to);
  });
});

describe("on-call (ONCALL_FOR)", () => {
  test("every roster entry is a real service + person", () => {
    for (const [svc, person] of ONCALL) {
      expect(serviceNames.has(svc), `missing service ${svc}`).toBe(true);
      expect(personNames.has(person), `missing person ${person}`).toBe(true);
    }
  });

  test("at least one tier-1 service in the outage line has an on-call person", () => {
    const oncall = new Set(ONCALL.map(([svc]) => svc));
    const critical = new Set(
      DEPENDS_ON.filter(([, , , critical]) => critical).map(([, to]) => to),
    );
    // ledger and payments-gateway both sit on critical paths and have on-call.
    expect(oncall.has("ledger")).toBe(true);
    for (const svc of critical) {
      expect(oncall.has(svc), `${svc} is on a critical path but has no on-call`).toBe(true);
    }
  });
});

describe("documents", () => {
  test("ids are unique, kinds valid, refs resolve", () => {
    const seen = new Set<string>();
    for (const d of DOCUMENTS) {
      expect(seen.has(d.id), `duplicate doc id ${d.id}`).toBe(false);
      seen.add(d.id);
      expect(DOC_KINDS).toContain(d.kind);
      for (const ref of d.refs) {
        expect(serviceNames.has(ref), `${d.id} refs missing service ${ref}`).toBe(true);
      }
    }
  });

  test("the ADR chain that the agent must find actually exists", () => {
    const ids = DOCUMENTS.map((d) => d.id);
    for (const required of ["adr-42", "rb-ledger", "pm-118", "ticket-903", "slack-payments-1"]) {
      expect(ids).toContain(required);
    }
  });
});

describe("incidents", () => {
  test("ids unique, affected services exist", () => {
    const seen = new Set<string>();
    for (const i of INCIDENTS) {
      expect(seen.has(i.id), `duplicate incident ${i.id}`).toBe(false);
      seen.add(i.id);
      expect([1, 2, 3]).toContain(i.severity);
      expect(["open", "resolved"]).toContain(i.status);
      for (const svc of i.affects) {
        expect(serviceNames.has(svc), `${i.id} affects missing service ${svc}`).toBe(true);
      }
    }
  });

  test("the demo story requires an open incident touching checkout-api", () => {
    const openOnCheckout = INCIDENTS.some(
      (i) => i.status === "open" && i.affects.includes("checkout-api"),
    );
    expect(openOnCheckout).toBe(true);
  });
});

describe("alerts", () => {
  test("names unique; the three wired alerts exist", () => {
    assertUnique(ALERTS.map((a) => a.name), "alert name");
    for (const required of ["checkout-5xx-rate", "ledger-write-p99", "risk-engine-timeout"]) {
      expect(alertNames.has(required), `missing alert ${required}`).toBe(true);
    }
  });
});

describe("memory", () => {
  test("every memory has a resolvable ABOUT target", () => {
    for (const m of [...SEMANTIC_MEMORY, ...PROCEDURAL_MEMORY]) {
      expect(memoryTargets.has(m.about), `memory '${m.key}' about missing entity ${m.about}`).toBe(
        true,
      );
    }
  });

  test("memory keys are unique and non-empty across kinds", () => {
    const keys = new Set<string>();
    for (const m of [...SEMANTIC_MEMORY, ...PROCEDURAL_MEMORY]) {
      expect(m.key.length).toBeGreaterThan(0);
      expect(keys.has(m.key), `duplicate memory key ${m.key}`).toBe(false);
      keys.add(m.key);
    }
    expect(SEMANTIC_MEMORY.length).toBeGreaterThan(0);
    expect(PROCEDURAL_MEMORY.length).toBeGreaterThan(0);
  });
});

describe("story coherence (the demo holds together)", () => {
  test("there is a ≤3-hop DEPENDS_ON path from ledger to checkout-api", () => {
    // Ledger migration → this is the cascade the agent is supposed to find.
    // Impact flows UP the dependency chain: ledger is depended on by
    // payments-gateway, which is depended on by checkout-api.
    const adj = new Map<string, string[]>();
    for (const [from, to] of DEPENDS_ON) {
      adj.set(to, [...(adj.get(to) ?? []), from]); // reverse: who depends on me
    }
    const distance = new Map<string, number>([["ledger", 0]]);
    const queue = ["ledger"];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (distance.has(next)) continue;
        distance.set(next, distance.get(cur)! + 1);
        queue.push(next);
      }
    }
    expect(distance.has("checkout-api"), "no path ledger → checkout-api").toBe(true);
    expect(distance.get("checkout-api")).toBeLessThanOrEqual(3);
    // And each hop is a real chain the triggers on: the alert fires on checkout-api.
    expect(alertNames.has("checkout-5xx-rate")).toBe(true);
  });
});