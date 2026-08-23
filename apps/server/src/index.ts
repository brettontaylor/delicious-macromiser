/**
 * Worker entry. Routing and the identity boundary.
 *
 * v1 auth is authless-with-an-unguessable-path (ARCHITECTURE.md §6). The URL
 * *is* the credential, so two rules are absolute:
 *   1. Identity is derived from the path, server-side. A `user_id` in tool
 *      arguments is ignored — never trust identity supplied by the model.
 *   2. The secret lives in the path, never a query string. Query strings leak
 *      into logs and proxies, and the MCP spec prohibits tokens in the URI query.
 */

import { handleRpc } from './mcp/server.ts';
import { SERVER_INFO } from './mcp/server.ts';
import { PARSE_ERROR, error, json } from './mcp/rpc.ts';
import { ensureUser, getUserTz } from './db/queries.ts';
import type { Ctx } from './db/queries.ts';

export interface Env {
  DB: D1Database;
  MCP_PATH_SECRET: string;
  DEFAULT_TZ?: string;
  OWNER_USER_ID?: string;
}

/**
 * Constant-time string compare. A plain `===` on a path secret leaks its
 * prefix through response timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare a fixed number of bytes so length alone does not shortcut the loop.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // ---------- health ----------
    // Deliberately unauthenticated and deliberately silent about the MCP path.
    if (path === '/health') {
      return json({ ok: true, service: SERVER_INFO.name, version: SERVER_INFO.version });
    }

    // ---------- MCP ----------
    const mcpMatch = /^\/mcp\/([A-Za-z0-9_-]{16,128})$/.exec(path);
    if (mcpMatch) {
      if (!env.MCP_PATH_SECRET) {
        console.error(JSON.stringify({ event: 'config_error', detail: 'MCP_PATH_SECRET unset' }));
        return json({ error: 'server misconfigured' }, 500);
      }
      if (!timingSafeEqual(mcpMatch[1]!, env.MCP_PATH_SECRET)) {
        // 404, not 401 — an unguessable path should not confirm it exists.
        return new Response('Not found', { status: 404 });
      }
      return handleMcp(request, env);
    }

    // A bare /mcp with no secret is the most likely misconfiguration. Say so
    // without revealing the correct path.
    if (path === '/mcp') {
      return json({ error: 'This server is served at /mcp/<secret>.' }, 404);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleMcp(request: Request, env: Env): Promise<Response> {
  // GET is for the optional server-initiated SSE stream. This server is
  // stateless and never initiates, so decline it rather than hold a socket open.
  if (request.method === 'GET') {
    return new Response('This server does not offer a server-initiated stream.', {
      status: 405,
      headers: { allow: 'POST, DELETE' },
    });
  }
  // No sessions to terminate; acknowledge so clients can shut down cleanly.
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(error(null, PARSE_ERROR, 'Request body is not valid JSON.'), 400);
  }

  const userId = env.OWNER_USER_ID || 'owner';
  const defaultTz = env.DEFAULT_TZ || 'America/New_York';

  // Context is built lazily — `initialize` and `tools/list` must answer without
  // touching D1, so a database hiccup cannot break the connector handshake.
  const makeCtx = async (): Promise<Ctx> => {
    const now = new Date();
    const stored = await getUserTz(env.DB, userId);
    const ctx: Ctx = { db: env.DB, userId, tz: stored ?? defaultTz, now };
    if (stored === null) await ensureUser(ctx);
    return ctx;
  };

  const started = Date.now();
  const response = await handleRpc(body, makeCtx);

  // Structured log: tool name, latency, outcome. No meal contents (ARCHITECTURE.md §7).
  const method = (body as { method?: string } | null)?.method;
  const toolName = (body as { params?: { name?: string } } | null)?.params?.name;
  console.log(
    JSON.stringify({
      event: 'mcp_call',
      method,
      tool: method === 'tools/call' ? toolName : undefined,
      user: userId,
      status: response.status,
      ms: Date.now() - started,
    }),
  );

  return response;
}
