import type { Ctx } from '../../db/queries.ts';
import { getMealsForRange, getBodyweightRange } from '../../db/queries.ts';
import { sumMeals } from '../../domain/totals.ts';
import type { MealRow } from '../../domain/totals.ts';
import { isValidDate, daysBetween } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString } from './args.ts';

const KINDS = ['meals', 'workouts', 'bodyweight'] as const;
type Kind = (typeof KINDS)[number];

/** Date-ranged retrieval for analysis, export, and "how was last month". */
export async function getHistory(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const start = reqString(args, 'start_date');
  const end = reqString(args, 'end_date');
  if (!isValidDate(start) || !isValidDate(end)) {
    throw new ArgError('"start_date" and "end_date" must be valid YYYY-MM-DD dates.');
  }
  if (start > end) throw new ArgError('"start_date" must not be after "end_date".');
  if (daysBetween(start, end) > 366) {
    throw new ArgError('Range is capped at 366 days. Request a narrower window.');
  }

  const rawInclude = args['include'];
  let include: Kind[] = [...KINDS];
  if (rawInclude !== undefined && rawInclude !== null) {
    if (!Array.isArray(rawInclude)) throw new ArgError('"include" must be an array.');
    include = rawInclude.map((v, i) => {
      if (typeof v !== 'string' || !KINDS.includes(v as Kind)) {
        throw new ArgError(`include[${i}] must be one of: ${KINDS.join(', ')}.`);
      }
      return v as Kind;
    });
  }

  const out: Record<string, unknown> = { start_date: start, end_date: end };

  if (include.includes('meals')) {
    const meals = await getMealsForRange(ctx, start, end);
    const byDate = new Map<string, MealRow[]>();
    for (const m of meals) {
      const bucket = byDate.get(m.local_date);
      if (bucket) bucket.push(m);
      else byDate.set(m.local_date, [m]);
    }
    // Per-day totals rather than a flat dump — the shape every question wants.
    out['meal_days'] = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, ms]) => ({
        local_date: date,
        totals: sumMeals(ms),
        meals: ms.map((m) => ({
          id: m.id,
          meal_type: m.meal_type,
          description: m.description,
          kcal: m.kcal,
          protein_g: m.protein_g,
          fat_g: m.fat_g,
          carb_g: m.carb_g,
          alcohol_g: m.alcohol_g,
          source: m.source,
        })),
      }));
  }

  if (include.includes('workouts')) {
    const res = await ctx.db
      .prepare(
        `SELECT w.id, w.local_date, w.session_label, w.notes,
                s.exercise, s.exercise_raw, s.set_no, s.reps, s.weight_lb, s.rpe, s.completed
           FROM workouts w
           LEFT JOIN sets s ON s.workout_id = w.id
          WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? AND w.deleted_at IS NULL
          ORDER BY w.local_date ASC, s.exercise ASC, s.set_no ASC`,
      )
      .bind(ctx.userId, start, end)
      .all<{
        id: string; local_date: string; session_label: string | null; notes: string | null;
        exercise: string | null; exercise_raw: string | null; set_no: number | null;
        reps: number | null; weight_lb: number | null; rpe: number | null; completed: number | null;
      }>();

    const workouts = new Map<
      string,
      { id: string; local_date: string; session_label: string | null; notes: string | null; sets: unknown[] }
    >();
    for (const r of res.results ?? []) {
      let w = workouts.get(r.id);
      if (!w) {
        w = { id: r.id, local_date: r.local_date, session_label: r.session_label, notes: r.notes, sets: [] };
        workouts.set(r.id, w);
      }
      if (r.exercise !== null) {
        w.sets.push({
          exercise: r.exercise,
          exercise_raw: r.exercise_raw,
          set_no: r.set_no,
          reps: r.reps,
          weight_lb: r.weight_lb,
          rpe: r.rpe,
          completed: r.completed === 1,
        });
      }
    }
    out['workouts'] = [...workouts.values()];
  }

  if (include.includes('bodyweight')) {
    out['bodyweight'] = await getBodyweightRange(ctx, start, end);
  }

  return out;
}
