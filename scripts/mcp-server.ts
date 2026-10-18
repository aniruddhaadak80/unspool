#!/usr/bin/env bun
/**
 * Standalone MCP server (stdio) exposing Unspool's graph tools to any MCP
 * client. Run it with:
 *
 *   FALKORDB_URL=falkor://... FALKORDB_PASSWORD=... bun scripts/mcp-server.ts
 *
 * Then register in Claude Desktop / Cursor:
 *   { "command": "bun", "args": ["scripts/mcp-server.ts"],
 *     "env": { "FALKORDB_URL": "...", "FALKORDB_PASSWORD": "..." } }
 *
 * Every tool call runs real Cypher against FalkorDB and records a :TraceStep,
 * so external-agent reasoning shows up in the same replay UI.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { graphNameFor, normalizeTenantId, selectGraph } from "../src/lib/graph/falkordb";
import { buildMcpServer } from "../src/lib/agent/mcp";

const tenant = normalizeTenantId(process.env.UNSPOOL_TENANT);
const graph = await selectGraph(tenant);
const runId = `mcp_${Date.now().toString(36)}`;
const server = buildMcpServer(graph, runId);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[unspool-mcp] connected (tenant=${tenant}, graph=${graphNameFor(tenant)})`);
