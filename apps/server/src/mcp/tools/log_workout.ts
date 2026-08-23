import type { Ctx, NewSet } from '../../db/queries.ts';
import { insertWorkout } from '../../db/queries.ts';
import { normalizeExercise } from '../../domain/exercise.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, optString, resolveWhen } from './args.ts';

/**
 * One call per session, not per set. Ambiguous loads are logged as null and
 * reported back in `incomplete_sets` — "log it and flag it", never "ask again"
 * (README §4, principle 4).
 */
export async function logWorkout(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const when = resolveWhen(args, ctx.now, ctx.tz);
  const raw = args['sets'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('"sets" is required and must be a non-empty array.');
  }
  if (raw.length > 200) {
    throw new ArgError('"sets" is capped at 200 per call. Split the session.');
  }

  const sets: NewSet[] = [];
  const incomplete: string[] = [];

  raw.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`sets[${i}] must be an object.`);
    }
    const s = entry as Record<string, unknown>;

    const exerciseRaw = s['exercise'];
    if (typeof exerciseRaw !== 'string' || exerciseRaw.trim() === '') {
      throw new ArgError(`sets[${i}].exercise is required.`);
    }

    const setNo = s['set_no'];
    if (typeof setNo !== 'number' || !Number.isInteger(setNo) || setNo < 1) {
      throw new ArgError(`sets[${i}].set_no must be a whole number of 1 or more.`);
    }

    const numOrNull = (key: string): number | null => {
      const v = s[key];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ArgError(`sets[${i}].${key} must be a finite number.`);
      }
      if (v < 0) throw new ArgError(`sets[${i}].${key} cannot be negative.`);
      return v;
    };

    const reps = numOrNull('reps');
    const weight = numOrNull('weight_lb');
    const rpe = numOrNull('rpe');
    if (rpe !== null && (rpe < 1 || rpe > 10)) {
      throw new ArgError(`sets[${i}].rpe must be between 1 and 10.`);
    }

    const exercise = normalizeExercise(exerciseRaw);
    if (reps === null || weight === null) {
      incomplete.push(
        `${exerciseRaw.trim()} set ${setNo}: missing ${reps === null ? 'reps' : ''}${
          reps === null && weight === null ? ' and ' : ''
        }${weight === null ? 'weight_lb' : ''}`,
      );
    }

    sets.push({
      exercise,
      exercise_raw: exerciseRaw.trim(),
      set_no: setNo,
      reps,
      weight_lb: weight,
      rpe,
      completed: s['completed'] === undefined ? true : s['completed'] === true,
    });
  });

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
