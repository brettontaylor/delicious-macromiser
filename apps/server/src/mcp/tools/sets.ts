import type { NewSet } from '../../db/queries.ts';
import { normalizeExercise } from '../../domain/exercise.ts';
import { ArgError } from './args.ts';

export interface ParsedSets {
  sets: NewSet[];
  /** Human-readable notes for sets missing reps or load. Empty means fully recorded. */
  incomplete: string[];
}

/**
 * Shared by `log_workout` (one session) and `import_days` (many). Extracted so
 * the two paths cannot drift on validation — an imported session has to be
 * exactly as trustworthy as a live one, or the history is not comparable.
 *
 * `label` prefixes error messages so a failure inside a 30-day import names the
 * day it came from rather than just an array index.
 */
export function parseSets(raw: unknown, label = 'sets'): ParsedSets {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError(`"${label}" is required and must be a non-empty array.`);
  }
  if (raw.length > 200) {
    throw new ArgError(`"${label}" is capped at 200 per session. Split the session.`);
  }

  const sets: NewSet[] = [];
  const incomplete: string[] = [];

  raw.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`${label}[${i}] must be an object.`);
    }
    const s = entry as Record<string, unknown>;

    const exerciseRaw = s['exercise'];
    if (typeof exerciseRaw !== 'string' || exerciseRaw.trim() === '') {
      throw new ArgError(`${label}[${i}].exercise is required.`);
    }

    // Defaulting set_no to position keeps a bulk import from failing on a
    // detail the model has no real information about. A single live call still
    // sends it explicitly.
    const rawSetNo = s['set_no'];
    const setNo = rawSetNo === undefined || rawSetNo === null ? i + 1 : rawSetNo;
    if (typeof setNo !== 'number' || !Number.isInteger(setNo) || setNo < 1) {
      throw new ArgError(`${label}[${i}].set_no must be a whole number of 1 or more.`);
    }

    const numOrNull = (key: string): number | null => {
      const v = s[key];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ArgError(`${label}[${i}].${key} must be a finite number.`);
      }
      if (v < 0) throw new ArgError(`${label}[${i}].${key} cannot be negative.`);
      return v;
    };

    const reps = numOrNull('reps');
    const weight = numOrNull('weight_lb');
    const rpe = numOrNull('rpe');
    if (rpe !== null && (rpe < 1 || rpe > 10)) {
      throw new ArgError(`${label}[${i}].rpe must be between 1 and 10.`);
    }

    if (reps === null || weight === null) {
      incomplete.push(
        `${exerciseRaw.trim()} set ${setNo}: missing ${reps === null ? 'reps' : ''}${
          reps === null && weight === null ? ' and ' : ''
        }${weight === null ? 'weight_lb' : ''}`,
      );
    }

    sets.push({
      exercise: normalizeExercise(exerciseRaw),
      exercise_raw: exerciseRaw.trim(),
      set_no: setNo,
      reps,
      weight_lb: weight,
      rpe,
      completed: s['completed'] === undefined ? true : s['completed'] === true,
    });
  });

  return { sets, incomplete };
}
