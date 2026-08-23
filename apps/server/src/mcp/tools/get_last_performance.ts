import type { Ctx } from '../../db/queries.ts';
import { getSetsForExercise } from '../../db/queries.ts';
import { buildHistory } from '../../domain/progression.ts';
import { normalizeExercise } from '../../domain/exercise.ts';
import { localDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError } from './args.ts';

/**
 * The differentiating tool (README §2). Returns data only — the progression
 * rule lives in the Skill so it can change weekly without a deploy.
 *
 * An exercise with no history returns an explicit empty entry rather than being
 * omitted, so the assistant can say "no history for this lift" instead of
 * quietly filling the gap with a guess.
 */
export async function getLastPerformance(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const raw = args['exercises'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('"exercises" is required and must be a non-empty array of names.');
  }
  if (raw.length > 20) {
    throw new ArgError('"exercises" is capped at 20 per call.');
  }

  const requested = raw.map((r, i) => {
    if (typeof r !== 'string' || r.trim() === '') {
      throw new ArgError(`exercises[${i}] must be a non-empty string.`);
    }
    return { raw: r.trim(), key: normalizeExercise(r) };
  });

  const today = localDate(ctx.now, ctx.tz);

  // Distinct keys only — "squat" and "squats" resolve to the same history.
  const uniqueKeys = [...new Set(requested.map((r) => r.key))];
  const histories = await Promise.all(
    uniqueKeys.map(async (key) => {
      const rows = await getSetsForExercise(ctx, key, 4);
      return [key, buildHistory(key, rows, today)] as const;
    }),
  );
  const byKey = new Map(histories);

  return {
    as_of: today,
    exercises: requested.map((r) => {
      const h = byKey.get(r.key)!;
      return {
        requested_as: r.raw,
        exercise: h.exercise,
        movement_pattern: h.movement_pattern,
        sessions_logged: h.sessions_logged,
        has_history: h.sessions_logged > 0,
        // Stated explicitly so the "never advance a lift performed < 2 times"
        // rule has a fact to act on rather than an inference.
        enough_history_to_progress: h.sessions_logged >= 2,
        last: h.last,
        previous: h.previous,
      };
    }),
  };
}
