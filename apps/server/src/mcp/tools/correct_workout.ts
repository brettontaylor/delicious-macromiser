import type { Ctx, SetPatch } from '../../db/queries.ts';
import {
  getWorkoutById,
  recentWorkoutIds,
  updateSet,
  deleteSet,
  updateWorkoutMeta,
  softDeleteWorkout,
} from '../../db/queries.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString } from './args.ts';

/**
 * Fix a logged session.
 *
 * This matters more than the equivalent for meals. A wrong meal number sits in
 * an average; a wrong SET number propagates — `get_last_performance` reads it,
 * the Skill's progression rule reads that, and the next session's load is
 * proposed from it. One mistyped rep count quietly drives a wrong
 * recommendation until somebody notices.
 *
 * Sets are addressed by `set_no` within the session rather than by id, because
 * that is how a person refers to them: "the third set was only 3 reps".
 */
export async function correctWorkout(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'workout_id');
  const before = await getWorkoutById(ctx, id);
  if (!before) {
    const recent = await recentWorkoutIds(ctx, 5);
    throw new ArgError(
      `NOT CHANGED — no session with id "${id}". Recent sessions: ${
        recent.map((w) => `${w.local_date} (${w.id})`).join(', ') || 'none'
      }`,
    );
  }

  const changes: string[] = [];

  // ---- session-level ----
  const label = optString(args, 'session_label');
  const notes = optString(args, 'notes');
  if (label !== null || notes !== null) {
    await updateWorkoutMeta(ctx, id, {
      ...(label !== null ? { session_label: label } : {}),
      ...(notes !== null ? { notes } : {}),
    });
    if (label !== null) changes.push(`label -> "${label}"`);
    if (notes !== null) changes.push('notes updated');
  }

  // ---- set-level ----
  const raw = args['sets'];
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) throw new ArgError('"sets" must be an array.');

    for (const [i, entry] of raw.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        throw new ArgError(`sets[${i}] must be an object.`);
      }
      const s = entry as Record<string, unknown>;
      const setNo = s['set_no'];
      if (typeof setNo !== 'number' || !Number.isInteger(setNo) || setNo < 1) {
        throw new ArgError(`sets[${i}].set_no must be a whole number of 1 or more.`);
      }
      const existing = before.sets.find((x) => x.set_no === setNo);
      if (!existing) {
        throw new ArgError(
          `NOT CHANGED — that session has no set ${setNo}. It has ${before.sets.length}.`,
        );
      }

      if (s['remove'] === true) {
        await deleteSet(ctx, id, setNo);
        changes.push(`set ${setNo} removed`);
        continue;
      }

      const patch: SetPatch = {};
      const num = (key: 'reps' | 'weight_lb' | 'rpe') => {
        const v = s[key];
        if (v === undefined) return;
        if (v === null) {
          patch[key] = null;
          return;
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          throw new ArgError(`sets[${i}].${key} must be a non-negative number, or null if unknown.`);
        }
        if (key === 'rpe' && (v < 1 || v > 10)) {
          throw new ArgError(`sets[${i}].rpe must be between 1 and 10.`);
        }
        patch[key] = v;
      };
      num('reps'); num('weight_lb'); num('rpe');
      if (s['completed'] !== undefined) patch.completed = s['completed'] === true;

      if (Object.keys(patch).length === 0) {
        throw new ArgError(`sets[${i}] has nothing to change. Send a field, or remove: true.`);
      }
      await updateSet(ctx, id, setNo, patch);
      changes.push(
        `set ${setNo}: ${Object.entries(patch)
          .map(([k, v]) => `${k}=${v === null ? 'unknown' : v}`)
          .join(', ')}`,
      );
    }
  }

  if (changes.length === 0) {
    throw new ArgError('NOT CHANGED — nothing to change. Send session_label, notes, or sets.');
  }

  const after = await getWorkoutById(ctx, id);
  return {
    corrected: true,
    workout_id: id,
    local_date: before.local_date,
    changes,
    sets_now: after?.sets.map((s) => ({
      set_no: s.set_no,
      exercise: s.exercise_raw ?? s.exercise,
      weight_lb: s.weight_lb,
      reps: s.reps,
      rpe: s.rpe,
      completed: s.completed === 1,
    })),
    // Say this out loud: the reason to fix a session is that the next one is
    // planned from it.
    note: 'get_last_performance will now read the corrected numbers, so the next load recommendation reflects this.',
  };
}

/** Soft delete a whole session. The row stays, so a mistaken delete is
 *  recoverable, and every read already filters `deleted_at IS NULL`. */
export async function deleteWorkout(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'workout_id');
  const before = await getWorkoutById(ctx, id);
  if (!before) throw new ArgError(`NOT DELETED — no session with id "${id}".`);

  const ok = await softDeleteWorkout(ctx, id);
  if (!ok) throw new ArgError('NOT DELETED — the session could not be removed.');

  return {
    deleted: true,
    workout_id: id,
    local_date: before.local_date,
    removed: {
      session_label: before.session_label,
      sets: before.sets.length,
      exercises: [...new Set(before.sets.map((s) => s.exercise_raw ?? s.exercise))],
    },
    recoverable: true,
  };
}
