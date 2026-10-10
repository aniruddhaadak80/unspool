import { tool, type ToolSet } from "ai";
import { toolDefs, type ToolContext } from "@/lib/agent/registry";

/**
 * AI SDK adapter over the neutral tool registry. The registry is the single
 * source of truth — the MCP server (`mcp.ts`) adapts the same definitions, so
 * an agent picking tools "through MCP" and the in-process agent use identical
 * capabilities.
 */
export function buildTools(ctx: ToolContext): ToolSet {
  const tools: ToolSet = {};
  for (const def of toolDefs(ctx)) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.schema,
      execute: (args) => def.handler(args, ctx),
    });
  }
  return tools;
}

export type AgentTools = ToolSet;
