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
import { renderApp } from './app/page.ts';
import { runBackup, scheduledBackup } from './backup.ts';
import { handleAppWrite, handleAppCapture } from './app/write.ts';
import { renderRecipes } from './app/recipes.ts';
import { renderRoadmap } from './app/roadmap.ts';
import type { Ctx } from './db/queries.ts';

export interface Env {
  DB: D1Database;
  MCP_PATH_SECRET: string;
  /**
   * Separate secret for the read-only web view. Deliberately not MCP_PATH_SECRET:
   * that one grants writes, so a link you can send someone must be revocable
   * without breaking the connector. Unset means the view is simply off.
   */
  APP_VIEW_SECRET?: string;
  /**
   * Opens the same page with editing enabled. A third secret rather than a flag
   * on the second one, because the read link exists to be shared and editing
   * must not ride along with it. Each is revocable without touching the others.
   */
  APP_EDIT_SECRET?: string;
  /** Nightly D1 snapshots. Unbound simply disables backup. */
  BACKUPS?: R2Bucket;
  /** Meal photos from the app. Unbound disables photo capture; text still works. */
  CAPTURES?: R2Bucket;
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

    // ---------- web view ----------
    // Three secrets, three capabilities, all independently revocable:
    //   MCP_PATH_SECRET  — the connector. Full write access via tools.
    //   APP_EDIT_SECRET  — this page, editable. Personal.
    //   APP_VIEW_SECRET  — this page, read-only. The one that is safe to send.
    // Resolving capability from the secret means a shared link cannot be
    // escalated by guessing a URL.
    const appMatch = /^\/app\/([A-Za-z0-9_-]{16,128})(\/[a-z]+)?$/.exec(path);
    if (appMatch) {
      const given = appMatch[1]!;
      const action = appMatch[2] ?? '';
      const canEdit = !!env.APP_EDIT_SECRET && timingSafeEqual(given, env.APP_EDIT_SECRET);
      const canRead = canEdit || (!!env.APP_VIEW_SECRET && timingSafeEqual(given, env.APP_VIEW_SECRET));
      // An unconfigured secret means that capability is off, not open — and a
      // wrong secret gets the same 404, so the response never distinguishes them.
      if (!canRead) return new Response('Not found', { status: 404 });

      const userId = env.OWNER_USER_ID || 'owner';
      const now = new Date();
      const stored = await getUserTz(env.DB, userId);
      const ctx: Ctx = {
        db: env.DB, userId, tz: stored ?? (env.DEFAULT_TZ || 'America/New_York'), now,
        captures: env.CAPTURES,
      };

      const isRead = request.method === 'GET' || request.method === 'HEAD';

      if (isRead && action === '/recipes') {
        // Read-only for both capabilities: the book and the pantry are not
        // sensitive the way the food log is.
        return renderRecipes(ctx, given, canEdit);
      }

      if (isRead && action === '/roadmap') {
        // Bundled reference data, no D1 read and nothing personal — it is the
        // same plan the public repo already carries.
        return renderRoadmap(given);
      }

      if (isRead) {
        const requested = url.searchParams.get('date');
        const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : null;
        return renderApp(ctx, date, { canEdit, secret: given, notice: url.searchParams.get('ok') });
      }

      if (request.method === 'POST' && action === '/capture') {
        if (!canEdit) return new Response('This link is read-only.', { status: 403 });
        return handleAppCapture(ctx, request, given, env.CAPTURES);
      }

      if (request.method === 'POST' && (action === '/save' || action === '/remove')) {
        if (!canEdit) {
          // The read link reached a write path. Say so plainly rather than 404 —
          // the page is real, the capability is not.
          return new Response('This link is read-only.', { status: 403 });
        }
        return handleAppWrite(ctx, request, given, action === '/remove');
      }

      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: canEdit ? 'GET, HEAD, POST' : 'GET, HEAD' },
      });
    }

    // ---------- manual backup trigger ----------
    // Gated on the write secret, not the view secret: taking a snapshot is an
    // operational action, not something a shared read link should be able to do.
    const backupMatch = /^\/backup\/([A-Za-z0-9_-]{16,128})$/.exec(path);
    if (backupMatch) {
      if (!env.MCP_PATH_SECRET || !timingSafeEqual(backupMatch[1]!, env.MCP_PATH_SECRET)) {
        return new Response('Not found', { status: 404 });
      }
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      }
      if (!env.BACKUPS) return json({ error: 'no backup bucket bound' }, 503);
      try {
        return json(await runBackup(env, new Date()));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    // A bare /mcp with no secret is the most likely misconfiguration. Say so
    // without revealing the correct path.
    if (path === '/mcp') {
      return json({ error: 'This server is served at /mcp/<secret>.' }, 404);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledBackup(env, new Date()));
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
    const ctx: Ctx = { db: env.DB, userId, tz: stored ?? defaultTz, now, captures: env.CAPTURES };
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
