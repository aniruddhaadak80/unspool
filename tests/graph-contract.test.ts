/**
 * Graph-contract test — the guard that catches a "phantom" relationship type.
 *
 * A phantom edge is one the agent traverses (and the docs promise) but that
 * nothing ever creates. Unit tests can't see it: the Cypher is syntactically
 * valid, it just matches zero rows on a real graph. That is exactly what
 * happened with `[:HAS_MEMBER]` (Team → Person): `getServiceOwnership` and
 * `page_on_call` joined on it, the README documented it — but the seeder wrote
 * `[:MEMBER_OF]` instead, so "who do I page?" would have answered "unassigned"
 * and the roster would have come back empty, with every test still green.
 *
 * This test reads the real Cypher out of the source and fails if any traversed
 * relationship type is never created. It needs no database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REL_TYPES } from "../src/lib/graph/schema";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** Pull `[:TYPE]` tokens out of Cypher embedded in a TS source file. */
const relTypes = (src: string): string[] =>
  [...src.matchAll(/\[:([A-Z][A-Z_]*)/g)].map((m) => m[1]);

const SOURCES = {
  seed: "../src/lib/graph/seed.ts",
  queries: "../src/lib/graph/queries.ts",
  actions: "../src/lib/agent/actions.ts",
  memory: "../src/lib/agent/memory.ts",
  trace: "../src/lib/agent/trace.ts",
  orchestrator: "../src/lib/agent/orchestrator.ts",
  registry: "../src/lib/agent/registry.ts",
  verify: "../scripts/verify.ts",
} as const;

const src = Object.fromEntries(
  Object.entries(SOURCES).map(([key, path]) => [key, read(path)]),
) as Record<keyof typeof SOURCES, string>;

/** Relationship types some code path actually CREATE/MERGEs. */
const created = new Set<string>([
  ...relTypes(src.seed),
  ...relTypes(src.actions),
  ...relTypes(src.memory),
  ...relTypes(src.trace),
]);

/** Relationship types any code path traverses. */
const traversed = new Set<string>(Object.values(src).flatMap(relTypes));

describe("graph contract", () => {
  test("every traversed relationship type is created somewhere", () => {
    const missing = [...traversed].filter((t) => !created.has(t)).sort();
    expect(missing, `traversed but never created: ${missing.join(", ")}`).toEqual([]);
  });

  test("every created relationship type is in the canonical schema", () => {
    const canonical = new Set<string>(REL_TYPES);
    const missing = [...created].filter((t) => !canonical.has(t)).sort();
    expect(missing, `created but undocumented: ${missing.join(", ")}`).toEqual([]);
  });

  test("the canonical schema contains no unused placeholder types", () => {
    const canonical = new Set<string>(REL_TYPES);
    const unused = [...canonical].filter((t) => !created.has(t)).sort();
    expect(unused, `documented but never created: ${unused.join(", ")}`).toEqual([]);
  });

  test("regression: the membership edge is HAS_MEMBER (seed once wrote MEMBER_OF)", () => {
    expect(created.has("HAS_MEMBER"), "seeder must create [:HAS_MEMBER] Team → Person").toBe(true);
    expect(traversed.has("HAS_MEMBER"), "ownership/on-call queries traverse [:HAS_MEMBER]").toBe(true);
    // The phantom that broke the on-call join must not come back via the seeder.
    expect([...created]).not.toContain("MEMBER_OF");
  });
});
