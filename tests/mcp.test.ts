/**
 * MCP tests — prove the tool registry is genuinely exposed over the Model
 * Context Protocol, using the SDK's own stateless transport (the same one
 * `/api/mcp` uses on Vercel). No database needed: `toolDefs()` builds the
 * definitions without touching the graph, so a stub `Graph` is enough here.
 */
import { describe, expect, test } from "bun:test";
import type { Graph } from "falkordb";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer, SCHEMA_RESOURCE } from "../src/lib/agent/mcp";
import { toolDefs } from "../src/lib/agent/registry";
import { REL_TYPES } from "../src/lib/graph/schema";

// A stub graph: handlers never run, so we never query.
const stubGraph = {} as Graph;

/** One stateless request against a freshly built server, mirroring the route. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id: number | null = 1,
): Promise<Record<string, unknown>> {
  const server = buildMcpServer(stubGraph, "test-run");
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
  const json = (await res.json()) as Record<string, unknown>;
  await Promise.allSettled([transport.close(), server.close()]);
  return json;
}

const resultOf = (json: Record<string, unknown>) => json.result as Record<string, unknown>;

describe("MCP server", () => {
  test("initialize negotiates a protocol version and advertises capabilities", async () => {
    const json = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    const result = resultOf(json);
    expect(result.protocolVersion).toBe("2025-06-18");
    expect((result.serverInfo as { name: string }).name).toBe("unspool");
    expect((result.capabilities as { tools?: unknown }).tools).toBeDefined();
  });

  test("tools/list exposes every registry tool, with a JSON schema", async () => {
    const result = resultOf(await rpc("tools/list"));
    const tools = (result.tools ?? []) as Array<{ name: string; description: string }>;

    const registry = toolDefs({ graph: stubGraph, runId: "test-run" }).map((d) => d.name).sort();
    const exposed = tools.map((t) => t.name).sort();
    expect(exposed, "MCP must expose exactly the registry's tools").toEqual(registry);

    // The hackathon-relevant capabilities must be reachable over MCP.
    for (const name of ["blast_radius", "run_algorithm", "page_on_call", "recall_memory"]) {
      expect(exposed).toContain(name);
    }
    // Every tool needs a description, or an agent can't select it.
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  test("tools/call answers a read-only tool without throwing", async () => {
    const result = resultOf(
      await rpc("tools/call", { name: "find_entities", arguments: { term: "ledger" } }),
    );
    // The stub graph has no `query`, so the handler must fail *gracefully* —
    // a JSON-RPC result with an isError content block, not a crash.
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(typeof content[0]?.type).toBe("string");
  });

  test("resources/list serves the graph schema as loadable context", async () => {
    const result = resultOf(await rpc("resources/list"));
    const resources = (result.resources ?? []) as Array<{ uri: string; mimeType?: string }>;
    expect(resources.map((r) => r.uri)).toContain("unspool://schema");
  });

  test("resources/read returns the schema, with every canonical rel type", async () => {
    const result = resultOf(
      await rpc("resources/read", { uri: "unspool://schema" }),
    );
    const contents = (result.contents ?? []) as Array<{ uri: string; text?: string }>;
    const text = contents[0]?.text ?? "";
    expect(contents[0]?.uri).toBe("unspool://schema");
    expect(text).toBe(SCHEMA_RESOURCE);
    for (const rel of REL_TYPES) {
      expect(text, `schema resource must document [:${rel}]`).toContain(`[:${rel}]`);
    }
    for (const label of ["Service", "Team", "Person", "Incident", "Evidence"]) {
      expect(text).toContain(label);
    }
  });

  test("prompts/list serves the incident-triage prompt", async () => {
    const result = resultOf(await rpc("prompts/list"));
    const prompts = (result.prompts ?? []) as Array<{ name: string; arguments?: unknown[] }>;
    expect(prompts.map((p) => p.name)).toContain("incident-triage");
  });

  test("prompts/get renders a triage playbook for the given incident", async () => {
    const result = resultOf(await rpc("prompts/get", { name: "incident-triage", arguments: { incident: "INC-2041" } }));
    const messages = (result.messages ?? []) as Array<{ role: string; content: { text?: string } }>;
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content.text).toContain("INC-2041");
    // The playbook must cite the tools it orders the agent to use.
    for (const tool of ["recall_memory", "blast_radius", "service_ownership", "page_on_call"]) {
      expect(messages[0]?.content.text).toContain(tool);
    }
  });

  test("unknown method returns a JSON-RPC error, not a crash", async () => {
    const json = await rpc("no/such/method", {}, 42);
    expect(json.error).toBeDefined();
    expect((json.error as { code: number }).code).toBe(-32601);
    expect(json.id).toBe(42);
  });
});
