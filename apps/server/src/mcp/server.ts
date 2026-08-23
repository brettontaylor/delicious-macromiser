/**
 * MCP method dispatch. Storage, retrieval, arithmetic — no opinions
 * (README §2, consequence 1).
 */

import type { Ctx } from '../db/queries.ts';
import { TOOLS, TOOLS_BY_NAME } from './tools/index.ts';
import { ArgError } from './tools/args.ts';
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  accepted,
  error,
  isNotification,
  isJsonRpcRequest,
  json,
  negotiateProtocol,
  result,
} from './rpc.ts';

export const SERVER_INFO = {
  name: 'macromiser',
  title: 'Macromiser',
  version: '0.1.0',
} as const;

const INSTRUCTIONS = `Macromiser is durable storage for nutrition and training history. It stores and retrieves; it does not coach.

Call get_today before answering anything about remaining calories or macros. Call get_last_performance before recommending any weight for any exercise. Never answer either from conversation context — the log is the source of truth and may contain entries from other sessions or devices.

When the user describes food they ate or a session they finished, log it without asking permission, then state the estimate you used so they can correct it.`;

/**
 * Marker a handler returns when it needs to emit MCP content blocks directly
 * rather than a JSON payload — an image, for instance. Everything else keeps
 * the text-plus-structuredContent shape, which is what tools want by default.
 */
export interface RawContent {
  __mcpContent: unknown[];
  /** Text payload alongside the blocks, so a client that renders only text still says something useful. */
  text?: string;
}

function isRawContent(v: unknown): v is RawContent {
  return typeof v === 'object' && v !== null && Array.isArray((v as RawContent).__mcpContent);
}

/** Result content for a tool call. Text-and-structured by default; a handler
 *  may return RawContent to emit blocks the protocol supports but tools here
 *  do not otherwise need. */
function toolResult(payload: unknown) {
  if (isRawContent(payload)) {
    return {
      content: [
        ...(payload.text ? [{ type: 'text', text: payload.text }] : []),
        ...payload.__mcpContent,
      ],
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false,
  };
}

/**
 * A failed tool call is reported as an MCP tool error, not a JSON-RPC error, so
 * the model sees it and can tell the user. ARCHITECTURE.md pitfall #5: a
 * dropped meal reported as saved is the worst possible bug.
 */
function toolError(message: string) {
  // "NOT SAVED" is the default lead-in because a dropped write reported as a
  // success is the worst bug this server can have. A message that already
  // states its own outcome (NOT DELETED, NOT CHANGED) keeps it rather than
  // stacking a second one.
  const stated = /^NOT [A-Z]+ —/.test(message);
  return {
    content: [{ type: 'text', text: stated ? message : `NOT SAVED — ${message}` }],
    isError: true,
  };
}

export async function handleRpc(body: unknown, makeCtx: () => Promise<Ctx>): Promise<Response> {
  if (Array.isArray(body)) {
    // JSON-RPC batching was removed in MCP 2025-06-18.
    return json(error(null, INVALID_REQUEST, 'Batched requests are not supported.'), 400);
  }
  if (!isJsonRpcRequest(body)) {
    return json(error(null, INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request.'), 400);
  }

  const id = body.id ?? null;
  const params = body.params ?? {};

  switch (body.method) {
    case 'initialize':
      return json(
        result(id, {
          protocolVersion: negotiateProtocol(params['protocolVersion']),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        }),
      );

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return accepted();

    case 'ping':
      // Phase 0's smoke test, kept as the liveness probe the spec defines.
      return isNotification(body) ? accepted() : json(result(id, {}));

    case 'tools/list':
      return json(
        result(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }),
      );

    case 'tools/call': {
      const name = params['name'];
      if (typeof name !== 'string') {
        return json(error(id, INVALID_PARAMS, '"name" is required.'), 400);
      }
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) {
        return json(error(id, INVALID_PARAMS, `Unknown tool: ${name}`), 400);
      }

      const rawArgs = params['arguments'];
      const args =
        typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};

      try {
        const ctx = await makeCtx();
        return json(result(id, toolResult(await tool.handler(ctx, args))));
      } catch (e) {
        if (e instanceof ArgError) {
          return json(result(id, toolError(e.message)));
        }
        console.error(
          JSON.stringify({
            event: 'tool_error',
            tool: name,
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        // No meal contents in logs (ARCHITECTURE.md §7) — tool name and message only.
        return json(
          result(
            id,
            toolError(
              'the write or read failed on the server. Tell the user it was not saved and do not retry silently.',
            ),
          ),
        );
      }
    }

    // Declared unsupported rather than silently 404'd, so clients stop asking.
    case 'resources/list':
    case 'resources/templates/list':
      return json(result(id, { resources: [], resourceTemplates: [] }));
    case 'prompts/list':
      return json(result(id, { prompts: [] }));

    default:
      if (isNotification(body)) return accepted();
      return json(error(id, METHOD_NOT_FOUND, `Method not found: ${body.method}`), 404);
  }
}

export { INTERNAL_ERROR };
