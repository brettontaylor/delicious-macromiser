/**
 * Prescriptions — write down the session, and read it back with the facts
 * needed to adjust it.
 *
 * The boundary trap this file exists to avoid: `get_session` must never
 * GENERATE a session. It returns what the model already wrote, plus the history
 * (`get_last_performance`'s own machinery) the model needs to write the next
 * one. Nothing here decides a load.
 */

import type { Ctx, NewPrescribedSet } from '../../db/queries.ts';
import {
  insertPrescription,
  getPrescription,
  getPrescriptionById,
  softDeletePrescription,
  getSetsForExercise,
  getWorkoutById,
  getBestSets,
} from '../../db/queries.ts';
import { buildHistory } from '../../domain/progression.ts';
import { normalizeExercise } from '../../domain/exercise.ts';
import {
  describeTarget,
  patternCoverage,
  reconcile,
  type PrescribedTarget,
} from '../../domain/prescription.ts';
import { localDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString, optLocalDate } from './args.ts';

const MAX_EXERCISES = 30;

/**
 * Parse the exercise list. Shaped deliberately like `parseSets` in ./sets.ts —
 * same error style, same normalization — because a prescription and the workout
 * that fulfils it have to agree on what a lift is called or reconciliation
 * silently reports zero.
 */
function parseTargets(raw: unknown): NewPrescribedSet[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('NOT SAVED — "exercises" is required and must be a non-empty array.');
  }
  if (raw.length > MAX_EXERCISES) {
    throw new ArgError(`NOT SAVED — "exercises" is capped at ${MAX_EXERCISES} per session.`);
  }

  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`exercises[${i}] must be an object.`);
    }
    const e = entry as Record<string, unknown>;

    const name = e['exercise'];
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ArgError(`exercises[${i}].exercise is required.`);
    }

    const intOrNull = (key: string): number | null => {
      const v = e[key];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new ArgError(`exercises[${i}].${key} must be a non-negative number.`);
      }
      return v;
    };

    const repLow = intOrNull('rep_low');
    const repHigh = intOrNull('rep_high');
    if (repLow !== null && repHigh !== null && repHigh < repLow) {
      throw new ArgError(`exercises[${i}]: rep_high is below rep_low.`);
    }

    return {
      ordinal: i + 1,
      exercise: normalizeExercise(name),
      exercise_raw: name.trim(),
      block: optString(e, 'block'),
      sets: intOrNull('sets'),
      rep_low: repLow,
      // A single number means a fixed target, not an open range.
      rep_high: repHigh ?? repLow,
      target_weight_lb: intOrNull('target_weight_lb'),
      notes: optString(e, 'notes'),
    };
  });
}

export async function prescribeSession(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const date = optLocalDate(args, 'date', ctx.now, ctx.tz);
  const targets = parseTargets(args['exercises']);

  const { id, replaced } = await insertPrescription(
    ctx,
    { local_date: date, label: optString(args, 'label'), notes: optString(args, 'notes') },
    targets,
  );

  const today = localDate(ctx.now, ctx.tz);
  const asTargets = targets as unknown as PrescribedTarget[];

  return {
    prescribed: true,
    prescription_id: id,
    local_date: date,
    backdated: date !== today,
    // Repeated back so the user can correct a load in the same breath, exactly
    // as log_meal states the estimate it used.
    session: asTargets.map(describeTarget),
    movement_patterns: patternCoverage(asTargets),
    // Non-zero means an earlier plan for this date was superseded, not that two
    // sessions now exist.
    replaced_previous: replaced > 0,
    reminder:
      'This is a plan, not a record. When the session actually happens, call log_workout ' +
      'with prescription_id so what was done is compared against what was planned.',
  };
}

export async function getSession(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const date = optLocalDate(args, 'date', ctx.now, ctx.tz);
  const today = localDate(ctx.now, ctx.tz);

  const presc = await getPrescription(ctx, date);
  if (!presc) {
    return {
      local_date: date,
      no_prescription: true,
      // Distinguished from "today is a rest day" for the same reason
      // get_training_plan distinguishes no_plan_set: they read the same on
      // screen and mean opposite things.
      note: 'Nothing has been written down for this date. Propose a session and call prescribe_session to keep it.',
      prescription: null,
      exercises: [],
    };
  }

  const targets = presc.sets as unknown as PrescribedTarget[];
  const keys = [...new Set(targets.map((t) => t.exercise))];

  // Prescription AND the history it will be adjusted against, in one round.
  // Splitting these would recreate exactly the multi-call latency get_briefing
  // was built to remove.
  const [histories, bests, workout] = await Promise.all([
    Promise.all(
      keys.map(async (k) => [k, buildHistory(k, await getSetsForExercise(ctx, k, 4), today)] as const),
    ),
    getBestSets(ctx, keys),
    presc.workout_id ? getWorkoutById(ctx, presc.workout_id) : Promise.resolve(null),
  ]);
  const byKey = new Map(histories);
  const bestByKey = new Map(bests.map((b) => [b.exercise, b]));

  return {
    local_date: date,
    no_prescription: false,
    prescription: {
      prescription_id: presc.id,
      label: presc.label,
      notes: presc.notes,
      status: presc.status,
      workout_id: presc.workout_id,
    },
    movement_patterns: patternCoverage(targets),
    exercises: targets.map((t) => {
      const h = byKey.get(t.exercise)!;
      const best = bestByKey.get(t.exercise);
      return {
        ordinal: t.ordinal,
        exercise: t.exercise,
        as_written: t.exercise_raw,
        block: t.block,
        target: {
          sets: t.sets,
          rep_low: t.rep_low,
          rep_high: t.rep_high,
          target_weight_lb: t.target_weight_lb,
        },
        reads_as: describeTarget(t),
        notes: t.notes,
        // The facts a progression rule needs. The rule itself is the Skill's.
        last: h.last,
        sessions_logged: h.sessions_logged,
        best_ever: best ? { weight_lb: best.weight_lb, local_date: best.local_date } : null,
      };
    }),
    // Present once a workout has been linked. Arithmetic, not a verdict.
    reconciliation: workout
      ? reconcile(
          targets,
          workout.sets.map((s) => ({
            exercise: s.exercise,
            reps: s.reps,
            weight_lb: s.weight_lb,
            completed: s.completed === 1,
          })),
        )
      : null,
  };
}

export async function deletePrescription(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'prescription_id');
  const before = await getPrescriptionById(ctx, id);
  if (!before) {
    throw new ArgError(
      `NOT DELETED — no prescription with id "${id}" (it may already be deleted). Call get_session for the right id.`,
    );
  }
  const ok = await softDeletePrescription(ctx, id);
  if (!ok) throw new ArgError('NOT DELETED — the prescription could not be removed.');

  return {
    deleted: true,
    prescription_id: id,
    local_date: before.local_date,
    removed: { label: before.label, exercises: before.sets.length },
    recoverable: true,
  };
}
