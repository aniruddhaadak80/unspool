import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Graph } from "falkordb";
import { toolDefs } from "@/lib/agent/registry";

/**
 * MCP adapter over the SAME tool registry the in-process agent uses.
 *
 * This is what backs the brief's "tool selection through MCP": the agent's
 * capabilities are not hardcoded into one framework. They are defined once,
 * exposed over the Model Context Protocol, and can be consumed by any MCP
 * client (Claude Desktop, Codex, Cursor, another agent). The in-process agent
 * simply binds the identical definitions through the AI SDK.
 *
 * `scripts/mcp-server.ts` runs this over stdio for local/external clients.
 */
export function buildMcpServer(graph: Graph, runId: string): McpServer {
  const server = new McpServer({ name: "unspool", version: "0.1.0" });

  for (const def of toolDefs({ graph, runId })) {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: def.description,
        // zod raw shape is accepted by the MCP SDK and converted to JSON schema
        inputSchema: def.schema.shape,
      },
      async (args: Record<string, unknown>) => {
        const result = await def.handler(args, { graph, runId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      },
    );
  }

  return server;
}
