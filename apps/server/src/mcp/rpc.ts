/**
 * Minimal stateless Streamable HTTP + JSON-RPC 2.0 for MCP.
 *
 * Why hand-rolled instead of the official SDK's StreamableHTTPServerTransport:
 * that transport is written against Node's `IncomingMessage`/`ServerResponse`,
 * which do not exist in Workers. Cloudflare's supported alternative is
 * `McpAgent`, which requires a Durable Object per session. This server is
 * stateless — every tool call is a self-contained read or write against D1 —
 * so a session object buys nothing and adds a moving part.
 *
 * This is a deliberate deviation from ARCHITECTURE.md §2. Revisit it if the
 * server ever needs server-initiated messages (sampling, elicitation,
 * progress notifications), which is the point where sessions start paying
 * for themselves.
 *
 * The tool-registration shape (name / description / JSON Schema) is unchanged
 * from the SDK's, so migrating later is a transport swap, not a rewrite.
 */

/** Latest as of @modelcontextprotocol/sdk 1.30.0. */
export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];
/** Sent when a client asks for a version we do not know. */
export const FALLBACK_PROTOCOL_VERSION = '2025-06-18';

export const JSONRPC_VERSION = '2.0';

// Standard JSON-RPC error codes.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: JSONRPC_VERSION, id, result: value };
}

export function error(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

/** A notification or response carries no id and gets an empty 202. */
export function accepted() {
  return new Response(null, { status: 202 });
}

export function negotiateProtocol(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : FALLBACK_PROTOCOL_VERSION;
}

export function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as JsonRpcRequest).jsonrpc === JSONRPC_VERSION &&
    typeof (v as JsonRpcRequest).method === 'string'
  );
}

/** True for a notification — no `id`, so no response may be sent. */
export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || req.id === null;
}
