/**
 * Tenant → graph naming, configuration detection, and stat parsing. These are
 * the pure parts of the FalkorDB layer, and `graphNameFor` is the isolation
 * boundary of the multigraph topology: every API surface funnels its tenant
 * through `selectGraph`, so this is the one place a tenant id becomes a name.
 * No database is involved.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { Graph } from "falkordb";
import {
  connectionConfig,
  graphNameFor,
  isFalkorConfigured,
  normalizeTenantId,
  runCypher,
} from "../src/lib/graph/falkordb";

const ENV_KEYS = [
  "FALKORDB_URL",
  "FALKORDB_HOST",
  "FALKORDB_PORT",
  "FALKORDB_USERNAME",
  "FALKORDB_PASSWORD",
  "FALKORDB_TLS",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

let restoreEnv: (() => void) | null = null;

/** Run a test against a clean FalkorDB environment, restored afterwards. */
function useEnv(values: Partial<Record<EnvKey, string>>) {
  restoreEnv?.();
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  restoreEnv = () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

describe("normalizeTenantId", () => {
  test("passes a well-formed id through", () => {
    expect(normalizeTenantId("demo")).toBe("demo");
    expect(normalizeTenantId("acme-staging")).toBe("acme-staging");
    expect(normalizeTenantId("a_b-c_2")).toBe("a_b-c_2");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeTenantId(" demo ")).toBe("demo");
  });

  test("strips everything outside [a-zA-Z0-9_-]", () => {
    expect(normalizeTenantId("a b")).toBe("ab");
    expect(normalizeTenantId("Acme Corp, Inc.")).toBe("AcmeCorpInc");
    // The rule is a whitelist, so injection-shaped input can only ever
    // contribute letters, digits, `_` and `-`.
    expect(normalizeTenantId("x'; DROP GRAPH")).toBe("xDROPGRAPH");
  });

  test("caps the length so callers can't mint unbounded graph names", () => {
    expect(normalizeTenantId("a".repeat(100))).toHaveLength(64);
  });

  test("falls back to the demo tenant when nothing survives", () => {
    for (const raw of [undefined, null, "", "   ", "..///", "???"]) {
      expect(normalizeTenantId(raw), JSON.stringify(raw)).toBe("demo");
    }
  });
});

describe("graphNameFor", () => {
  test("prefixes the normalized id", () => {
    expect(graphNameFor("demo")).toBe("unspool_demo");
    expect(graphNameFor("acme-staging")).toBe("unspool_acme-staging");
    expect(graphNameFor("")).toBe("unspool_demo");
  });

  test("hostile input can only produce a safe graph name", () => {
    for (const raw of ["a b", "x'; DROP GRAPH", "../etc/passwd", "😈", ""]) {
      expect(graphNameFor(raw), raw).toMatch(/^unspool_[a-zA-Z0-9_-]+$/);
    }
  });

  test("one rule for every surface: /api/agent and the others agree", () => {
    // /api/agent used to strip while graphNameFor escaped, so the same tenant
    // landed on `unspool_ab` through one endpoint and `unspool_a_b` through
    // another. Both now go through the same normalizer.
    expect(graphNameFor("a b")).toBe(graphNameFor("ab"));
    expect(graphNameFor("a b")).toBe("unspool_ab");
  });
});

describe("isFalkorConfigured", () => {
  test("nothing set counts as unconfigured", () => {
    useEnv({});
    expect(isFalkorConfigured()).toBe(false);
  });

  test("a real host is configured; a real URL is configured", () => {
    useEnv({ FALKORDB_HOST: "localhost" });
    expect(isFalkorConfigured()).toBe(true);

    useEnv({ FALKORDB_URL: "falkor://default:real-pw@db.example.com:6379" });
    expect(isFalkorConfigured()).toBe(true);
  });

  test(".env.example placeholders count as unconfigured", () => {
    useEnv({ FALKORDB_HOST: "YOUR_HOST" });
    expect(isFalkorConfigured()).toBe(false);

    useEnv({ FALKORDB_HOST: "your-host" });
    expect(isFalkorConfigured()).toBe(false);

    useEnv({ FALKORDB_URL: "falkor://default:real-pw@your-host:6379" });
    expect(isFalkorConfigured()).toBe(false);

    useEnv({ FALKORDB_URL: "falkor://default:your-password@db.example.com:6379" });
    expect(isFalkorConfigured()).toBe(false);
  });

  test("the URL wins when both are set", () => {
    useEnv({ FALKORDB_URL: "falkor://default:real-pw@your-host:6379", FALKORDB_HOST: "db.example.com" });
    expect(isFalkorConfigured()).toBe(false);
  });
});

describe("connectionConfig", () => {
  test("port defaults to 6379 and TLS to off", () => {
    useEnv({ FALKORDB_HOST: "localhost" });
    expect(connectionConfig()).toEqual({
      url: undefined,
      host: "localhost",
      port: 6379,
      username: undefined,
      password: undefined,
      tls: false,
    });
  });

  test("reads the remaining knobs from the environment", () => {
    useEnv({
      FALKORDB_HOST: "db.example.com",
      FALKORDB_PORT: "6380",
      FALKORDB_USERNAME: "operator",
      FALKORDB_PASSWORD: "pw",
      FALKORDB_TLS: "true",
    });
    expect(connectionConfig()).toEqual({
      url: undefined,
      host: "db.example.com",
      port: 6380,
      username: "operator",
      password: "pw",
      tls: true,
    });
  });
});

/** A `Graph` stand-in: the only method `runCypher` calls is `query`. */
function fakeGraph(respond: () => unknown) {
  return {
    query: async () => respond(),
  } as unknown as Graph;
}

describe("runCypher", () => {
  test("returns the rows and parses FalkorDB's stat metadata", async () => {
    const calls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
    const graph = {
      query: async (cypher: string, opts: { params: Record<string, unknown> }) => {
        calls.push({ cypher, params: opts.params });
        return {
          data: [{ name: "checkout" }],
          metadata: ["Nodes created: 3", "Relationships created: 1", "Cached execution: 1", "noise", 42],
        };
      },
    } as unknown as Graph;

    const { rows, stats } = await runCypher<{ name: string }>(graph, "MATCH (n) RETURN n", { x: 1 });

    expect(rows).toEqual([{ name: "checkout" }]);
    expect(stats).toEqual({
      "nodes created": 3,
      "relationships created": 1,
      "cached execution": 1,
    });
    expect(calls).toEqual([{ cypher: "MATCH (n) RETURN n", params: { x: 1 } }]);
  });

  test("parses negative and fractional stats, and ignores trailing units", async () => {
    const graph = fakeGraph(() => ({
      data: [],
      metadata: ["Nodes deleted: -2", "Score: 0.5", "Duration: 12 ms"],
    }));

    const { stats } = await runCypher(graph, "RETURN 1");

    expect(stats).toEqual({ "nodes deleted": -2, score: 0.5 });
  });

  test("tolerates a result with no data or metadata", async () => {
    const graph = fakeGraph(() => ({}));

    const { rows, stats } = await runCypher(graph, "RETURN 1");

    expect(rows).toEqual([]);
    expect(stats).toEqual({});
  });
});
