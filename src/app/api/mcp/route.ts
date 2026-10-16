import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isFalkorConfigured, selectGraph } from "@/lib/graph/falkordb";
import { buildMcpServer } from "@/lib/agent/mcp";

/**
 * GET /api/mcp — the MCP Streamable-HTTP endpoint.
 *
 * The same tool registry the in-process agent uses is exposed over MCP so any
 * external agent (Claude, Codex, Cursor, another Unspool) can select tools from
 * the deployed URL — no local stdio process required. `scripts/mcp-server.ts`
 * serves the identical server over stdio for local clients.
 *
 * Serverless constraints shape every choice here:
 *  - **stateless** (`sessionIdGenerator: undefined`) — Vercel lambdas have no
 *    shared memory, so a session id would break on the second request. Each
 *    POST builds a fresh server + transport and tears it down again.
 *  - **`enableJsonResponse: true`** — SSE streams don't survive a serverless
 *    response, so the transport emits a single JSON body instead.
 *  - The body is materialised before teardown so closing can't truncate it.
 *
 * `?tenant=…` (or `X-Tenant-Id`) picks the isolated graph; default is `demo`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function rpcError(status: number, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status },
  );
}

function tenantFor(req: NextRequest): string {
  return (
    req.nextUrl.searchParams.get("tenant") ??
    req.headers.get("x-tenant-id") ??
    "demo"
  );
}

async function handle(req: NextRequest) {
  if (req.method !== "POST") {
    // Streamable HTTP servers may omit the GET SSE stream; the spec allows 405.
    return rpcError(405, -32000, "Method not allowed. POST JSON-RPC messages to this URL.");
  }

  if (!isFalkorConfigured()) {
    return rpcError(
      503,
      -32000,
      "FalkorDB not configured. Set FALKORDB_URL, then tools will resolve against a real graph.",
    );
  }

  let server: ReturnType<typeof buildMcpServer> | null = null;
  let transport: WebStandardStreamableHTTPServerTransport | null = null;

  try {
    const graph = await selectGraph(tenantFor(req));
    // A per-request run id, so reasoning from MCP lands in the graph as its own
    // :AgentRun rather than being attributed to whichever UI run came first.
    const runId = `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    server = buildMcpServer(graph, runId);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session to persist across lambdas
      enableJsonResponse: true, // single JSON body; SSE can't stream through a lambda
    });

    await server.connect(transport);
    const res = await transport.handleRequest(req);

    // Fully materialise the JSON body, then release the per-request server.
    // `enableJsonResponse` means the body is complete once the promise resolves.
    const text = await res.text();
    const headers = new Headers(res.headers);
    return new NextResponse(text, { status: res.status, headers });
  } catch (err) {
    return rpcError(500, -32603, err instanceof Error ? err.message : String(err));
  } finally {
    // Teardown is best-effort: a leaked transport in a lambda dies with it, and
    // in dev it holds no stream once the JSON body has been materialised.
    await Promise.allSettled([
      transport?.close(),
      server?.close(),
    ]).catch(() => undefined);
  }
}

export { handle as POST, handle as GET, handle as DELETE };
