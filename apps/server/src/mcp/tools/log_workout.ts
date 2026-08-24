import type { Ctx } from '../../db/queries.ts';
import { insertWorkout, getBestSets } from '../../db/queries.ts';
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

  // Bests BEFORE the write, or every set in this session compares against
  // itself and nothing is ever a record.
  const exerciseKeys = [...new Set(sets.map((s) => s.exercise))];
  const priorBest = new Map(
    (await getBestSets(ctx, exerciseKeys)).map((b) => [b.exercise, b]),
  );

  const { workoutId, setCount } = await insertWorkout(
    ctx,
    when.localDate,
    optString(args, 'session_label'),
    optString(args, 'notes'),
    sets,
  );

  const exercises = exerciseKeys;

  // A set that beats everything before it. Facts only — whether it is worth
  // celebrating, and whether the user should now deload, is the Skill's call.
  const records = exerciseKeys
    .map((ex) => {
      const heaviest = sets
        .filter((s) => s.exercise === ex && s.completed !== false && s.weight_lb != null)
        .reduce<{ weight_lb: number; reps: number | null } | null>((best, s) => {
          const w = s.weight_lb as number;
          if (!best || w > best.weight_lb) return { weight_lb: w, reps: s.reps ?? null };
          if (w === best.weight_lb && (s.reps ?? 0) > (best.reps ?? 0)) {
            return { weight_lb: w, reps: s.reps ?? null };
          }
          return best;
        }, null);
      if (!heaviest) return null;
      const before = priorBest.get(ex);
      if (before && before.weight_lb >= heaviest.weight_lb) return null;
      return {
        exercise: ex,
        weight_lb: heaviest.weight_lb,
        reps: heaviest.reps,
        previous_best_lb: before?.weight_lb ?? null,
        first_ever: !before,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

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
    // Non-empty means a lifetime best was just set. first_ever true means this
    // is simply the first time the lift has been logged with a load, which is
    // not the same thing and should not be announced as a PR.
    personal_records: records,
  };
}
