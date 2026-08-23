import type { Ctx } from '../../db/queries.ts';
import {
  listPendingCaptures,
  getCaptureById,
  resolveCaptureRow,
} from '../../db/queries.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString, optNumber, reqEnum } from './args.ts';
import { daysBetween } from '../../util/date.ts';
import { localDate } from '../../util/date.ts';

/**
 * The queue of things the user recorded in the app that are not yet meals.
 *
 * The app deliberately has no LLM of its own. Analysis happens on the model the
 * user already pays for, reached through the connector they already added —
 * which is what "bring your own LLM" actually means for someone with a
 * subscription rather than an API key. The app captures; this hands the capture
 * over.
 */
export async function getPendingCaptures(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const limit = Math.min(Math.max(optNumber(args, 'limit') ?? 20, 1), 50);
  const rows = await listPendingCaptures(ctx, limit);
  const today = localDate(ctx.now, ctx.tz);

  return {
    count: rows.length,
    captures: rows.map((c) => ({
      capture_id: c.id,
      kind: c.kind,
      // Verbatim. Do not tidy it before logging — the user's own words are what
      // portion memory keys on later.
      note: c.note,
      local_date: c.local_date,
      days_ago: daysBetween(c.local_date, today),
      has_image: c.object_key !== null,
    })),
    note:
      rows.length === 0
        ? 'Nothing waiting.'
        : 'For each: estimate the macros and call log_meal with capture_id set — that logs the meal AND closes the capture in one call. If one is too vague to estimate, call resolve_capture with state "unusable" and say why. Never guess numbers to clear the queue.',
  };
}

/**
 * Close a capture that will not become a meal.
 *
 * The normal path is `log_meal` with a `capture_id`, which resolves it as a side
 * effect — one call, one approval. This exists for the case that matters more
 * than it looks: a capture too vague to estimate. Without it the only ways to
 * clear the queue are to invent numbers or to leave it stuck forever, and the
 * first is exactly what `confidence` exists to prevent.
 */
export async function resolveCapture(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'capture_id');
  const state = reqEnum(args, 'state', ['unusable'] as const);
  const reason = optString(args, 'reason');

  const capture = await getCaptureById(ctx, id);
  if (!capture) throw new ArgError(`NOT CHANGED — no capture with id "${id}".`);
  if (capture.state !== 'pending') {
    throw new ArgError(
      `NOT CHANGED — that capture is already ${capture.state}. Nothing to do.`,
    );
  }
  if (!reason || reason.trim().length < 3) {
    throw new ArgError(
      'NOT CHANGED — "reason" is required. Say what made it unusable so the user knows why it was dropped.',
    );
  }

  const ok = await resolveCaptureRow(ctx, id, state, { reason: reason.trim() });
  if (!ok) throw new ArgError('NOT CHANGED — the capture could not be resolved.');

  return {
    resolved: true,
    capture_id: id,
    state,
    reason: reason.trim(),
    note: 'Tell the user this one was dropped and why, rather than letting it disappear quietly.',
  };
}
