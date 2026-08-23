import type { Ctx } from '../../db/queries.ts';
import { insertWorkout } from '../../db/queries.ts';
import type { ToolArgs } from './index.ts';
import { optString, resolveWhen } from './args.ts';
import { parseSets } from './sets.ts';

/**
 * One call per session, not per set. Ambiguous loads are logged as null and
 * reported back in `incomplete_sets` — "log it and flag it", never "ask again"
 * (PRODUCT.md §4, principle 4).
 *
 * Set validation lives in ./sets.ts so this and `import_days` cannot drift.
 */
export async function logWorkout(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const when = resolveWhen(args, ctx.now, ctx.tz);
  const { sets, incomplete } = parseSets(args['sets']);

  const { workoutId, setCount } = await insertWorkout(
    ctx,
    when.localDate,
    optString(args, 'session_label'),
    optString(args, 'notes'),
    sets,
  );

  const exercises = [...new Set(sets.map((s) => s.exercise))];

  return {
    logged: true,
    workout_id: workoutId,
    local_date: when.localDate,
    backdated: when.backdated,
    sets_logged: setCount,
    exercises,
    // Non-empty means the write succeeded but some fields are unknown. Say so
    // to the user rather than presenting the session as fully recorded.
    incomplete_sets: incomplete,
  };
}
