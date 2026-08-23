/**
 * Shapes lift history for `get_last_performance`. Data, not advice
 * (ARCHITECTURE.md §5, "Deliberately absent").
 *
 * We return the facts a progression rule needs — top set, whether every
 * prescribed rep landed, RPE, days since — and stop there. The rule itself
 * (+5 upper / +10 lower, never advance under two sessions) lives in the Skill,
 * because it changes weekly and a schema shouldn't.
 */

import { daysBetween } from '../util/date.ts';
import { movementPattern } from './exercise.ts';

export interface SetRow {
  exercise: string;
  exercise_raw: string | null;
  set_no: number;
  reps: number | null;
  weight_lb: number | null;
  rpe: number | null;
  completed: number;
  local_date: string;
  session_label: string | null;
  workout_id?: string;
}

export interface SessionPerformance {
  local_date: string;
  /** Needed to reference this session in correct_workout or delete_workout —
   *  a wrong number is noticed HERE, so the id has to be here too. */
  workout_id: string | null;
  days_ago: number | null;
  session_label: string | null;
  sets: { set_no: number; reps: number | null; weight_lb: number | null; rpe: number | null; completed: boolean }[];
  /** Heaviest completed set. The reference point for the next load. */
  top_set: { reps: number | null; weight_lb: number | null; rpe: number | null } | null;
  /** Sum of reps x weight across completed sets. Comparable across rep schemes. */
  volume_lb: number;
  /** True when every logged set was completed. The precondition for advancing. */
  all_sets_completed: boolean;
  max_rpe: number | null;
}

export interface ExerciseHistory {
  exercise: string;
  movement_pattern: string;
  /** Reported so the Skill can honor "never advance a lift performed < 2 times". */
  sessions_logged: number;
  last: SessionPerformance | null;
  /** The three sessions before `last`, newest first. */
  previous: SessionPerformance[];
}

function shapeSession(date: string, rows: SetRow[], today: string): SessionPerformance {
  const workoutId = rows.find((r) => r.workout_id)?.workout_id ?? null;
  const sets = rows
    .slice()
    .sort((a, b) => a.set_no - b.set_no)
    .map((s) => ({
      set_no: s.set_no,
      reps: s.reps,
      weight_lb: s.weight_lb,
      rpe: s.rpe,
      completed: s.completed === 1,
    }));

  const completed = sets.filter((s) => s.completed);
  const top = completed.reduce<typeof completed[number] | null>((best, s) => {
    if (s.weight_lb === null) return best;
    if (!best || best.weight_lb === null || s.weight_lb > best.weight_lb) return s;
    // Same load, more reps is the better set.
    if (s.weight_lb === best.weight_lb && (s.reps ?? 0) > (best.reps ?? 0)) return s;
    return best;
  }, null);

  const rpes = sets.map((s) => s.rpe).filter((r): r is number => r !== null);

  return {
    local_date: date,
    workout_id: workoutId,
    days_ago: daysBetween(date, today),
    session_label: rows[0]?.session_label ?? null,
    sets,
    top_set: top ? { reps: top.reps, weight_lb: top.weight_lb, rpe: top.rpe } : null,
    volume_lb: Math.round(completed.reduce((a, s) => a + (s.reps ?? 0) * (s.weight_lb ?? 0), 0)),
    all_sets_completed: sets.length > 0 && sets.every((s) => s.completed),
    max_rpe: rpes.length ? Math.max(...rpes) : null,
  };
}

/**
 * Group flat set rows into per-session performances, newest first.
 * `rows` may span several dates and arrive in any order.
 */
export function buildHistory(exercise: string, rows: SetRow[], today: string): ExerciseHistory {
  const byDate = new Map<string, SetRow[]>();
  for (const r of rows) {
    const bucket = byDate.get(r.local_date);
    if (bucket) bucket.push(r);
    else byDate.set(r.local_date, [r]);
  }

  const sessions = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
    .map(([date, rs]) => shapeSession(date, rs, today));

  return {
    exercise,
    movement_pattern: movementPattern(exercise),
    sessions_logged: sessions.length,
    last: sessions[0] ?? null,
    previous: sessions.slice(1, 4),
  };
}
