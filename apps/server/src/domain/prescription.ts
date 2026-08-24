/**
 * Prescriptions — parsing targets, and comparing intent against what happened.
 *
 * Pure and D1-free. Nothing here generates a session: a tool that invented a
 * workout would put coaching in the server and break the boundary
 * PRODUCT.md §2 draws. This module parses what the model wrote down and does
 * the arithmetic of "did it match" — the verdict on whether a miss matters is
 * the Skill's.
 */

import { normalizeExercise } from './exercise.ts';
import { movementPattern } from './exercise.ts';

export interface PrescribedTarget {
  ordinal: number;
  exercise: string;
  exercise_raw: string | null;
  block: string | null;
  sets: number | null;
  rep_low: number | null;
  rep_high: number | null;
  target_weight_lb: number | null;
  notes: string | null;
}

/** Human phrasing for one target: "Back squat 4×6 @ 185". */
export function describeTarget(t: PrescribedTarget): string {
  const name = t.exercise_raw ?? t.exercise;
  const reps =
    t.rep_low === null
      ? ''
      : t.rep_high !== null && t.rep_high !== t.rep_low
        ? `${t.rep_low}-${t.rep_high}`
        : String(t.rep_low);
  const scheme = t.sets !== null && reps ? `${t.sets}×${reps}` : t.sets !== null ? `${t.sets} sets` : reps;
  const load = t.target_weight_lb !== null ? ` @ ${Math.round(t.target_weight_lb)}` : '';
  return [name, scheme].filter(Boolean).join(' ') + load;
}

/** Movement patterns a prescription covers. Answers "there is no hinge in this
 *  program at all", which was the sharpest observation in the source
 *  transcript and is derivable today. */
export function patternCoverage(targets: PrescribedTarget[]): string[] {
  return [...new Set(targets.map((t) => movementPattern(t.exercise)))].sort();
}

export interface LoggedSet {
  exercise: string;
  reps: number | null;
  weight_lb: number | null;
  completed: boolean;
}

export interface ExerciseComparison {
  exercise: string;
  prescribed: { sets: number | null; rep_low: number | null; target_weight_lb: number | null };
  actual: { sets: number; top_weight_lb: number | null; total_reps: number } | null;
  /** Every prescribed set landed at or above the target load. Null when there
   *  was no load target to judge against. */
  met: boolean | null;
}

export interface Reconciliation {
  compared: ExerciseComparison[];
  /** Logged exercises that were not in the prescription. Not a failure — a
   *  substitution is normal — but the model should know it happened. */
  unplanned: string[];
  /** Prescribed exercises with nothing logged at all. */
  missed: string[];
  /** Share of prescribed exercises that were trained, 0-100. */
  adherence_pct: number;
}

/**
 * Compare a prescription against a logged session, on the normalized exercise
 * slug so "RDL" and "romanian deadlift" reconcile.
 *
 * Arithmetic only. Whether 3 sets instead of 4 is a bad session depends on
 * sleep, load and the week — none of which belongs here.
 */
export function reconcile(targets: PrescribedTarget[], logged: LoggedSet[]): Reconciliation {
  const byExercise = new Map<string, LoggedSet[]>();
  for (const s of logged) {
    const key = s.exercise;
    byExercise.set(key, [...(byExercise.get(key) ?? []), s]);
  }

  const compared: ExerciseComparison[] = targets.map((t) => {
    const done = (byExercise.get(t.exercise) ?? []).filter((s) => s.completed);
    if (done.length === 0) {
      return {
        exercise: t.exercise,
        prescribed: { sets: t.sets, rep_low: t.rep_low, target_weight_lb: t.target_weight_lb },
        actual: null,
        met: t.target_weight_lb === null ? null : false,
      };
    }
    const loads = done.map((s) => s.weight_lb).filter((w): w is number => w !== null);
    const top = loads.length ? Math.max(...loads) : null;
    return {
      exercise: t.exercise,
      prescribed: { sets: t.sets, rep_low: t.rep_low, target_weight_lb: t.target_weight_lb },
      actual: {
        sets: done.length,
        top_weight_lb: top,
        total_reps: done.reduce((a, s) => a + (s.reps ?? 0), 0),
      },
      met:
        t.target_weight_lb === null
          ? null
          : top !== null &&
            top >= t.target_weight_lb &&
            (t.sets === null || done.length >= t.sets),
    };
  });

  const prescribedKeys = new Set(targets.map((t) => t.exercise));
  const unplanned = [...byExercise.keys()].filter((k) => !prescribedKeys.has(k));
  const missed = compared.filter((c) => c.actual === null).map((c) => c.exercise);
  const trained = compared.length - missed.length;

  return {
    compared,
    unplanned,
    missed,
    adherence_pct: compared.length === 0 ? 0 : Math.round((trained / compared.length) * 100),
  };
}

/** Normalization applied on the write path, so a prescription and the workout
 *  that fulfils it agree on what a lift is called. */
export function normalizeTargetName(raw: string): string {
  return normalizeExercise(raw);
}
