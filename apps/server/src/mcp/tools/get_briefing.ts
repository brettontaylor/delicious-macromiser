import type { Ctx } from '../../db/queries.ts';
import {
  getMealsForDate,
  getGoalsAsOf,
  getLastWorkoutDate,
  lookupPortions,
  listPendingCaptures,
  getTrainingPlan,
  getBodyweightRange,
  recentWorkoutIds,
  getMealsForRange,
} from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import { planView, weekdayIndex, WEEKDAY_NAMES } from '../../domain/plan.ts';
import { localDate, localWeekday, localTime, shiftDate, daysBetween } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';

/**
 * One call that answers "where am I".
 *
 * Not a convenience wrapper — a latency fix. Orienting used to mean get_today,
 * then get_training_plan, then get_week_summary, then get_pending_captures: four
 * round trips, four approval prompts, and four pauses in a conversation that is
 * supposed to feel like talking to someone. The user noticed, and they were
 * right.
 *
 * Every query here runs in ONE parallel round. Still facts only — the whole
 * point is to get the model to its judgement faster, not to make the judgement
 * for it.
 */
export async function getBriefing(ctx: Ctx, _args: ToolArgs): Promise<unknown> {
  const today = localDate(ctx.now, ctx.tz);
  const weekAgo = shiftDate(today, -6);

  const [meals, goals, lastWorkout, portions, pending, plan, bw, sessions, weekMeals] =
    await Promise.all([
      getMealsForDate(ctx, today),
      getGoalsAsOf(ctx, today),
      getLastWorkoutDate(ctx),
      lookupPortions(ctx, 10),
      listPendingCaptures(ctx, 10),
      getTrainingPlan(ctx),
      getBodyweightRange(ctx, shiftDate(today, -29), today),
      recentWorkoutIds(ctx, 5),
      getMealsForRange(ctx, weekAgo, today),
    ]);

  const totals = sumMeals(meals);
  const view = planView(plan, weekdayIndex(localWeekday(ctx.now, ctx.tz)));

  // Week shape, computed over days that actually have data — an average across
  // days you did not log is a lie about your week.
  const byDate = new Map<string, typeof meals>();
  for (const m of weekMeals) {
    const list = byDate.get(m.local_date) ?? [];
    list.push(m);
    byDate.set(m.local_date, list);
  }
  const dayTotals = [...byDate.values()].map(sumMeals);
  const avg = (pick: (t: ReturnType<typeof sumMeals>) => number) =>
    dayTotals.length === 0
      ? null
      : Math.round(dayTotals.reduce((a, t) => a + pick(t), 0) / dayTotals.length);

  const weights = bw.filter((r) => r.weight_lb !== null);
  const latest = weights[weights.length - 1];

  return {
    now: {
      local_date: today,
      weekday: localWeekday(ctx.now, ctx.tz),
      local_time: localTime(ctx.now, ctx.tz),
      timezone: ctx.tz,
    },

    today: {
      meals: meals.length,
      totals,
      remaining: remainingVsGoals(totals, goals),
      goals_set: goals !== null,
    },

    // Above zero means the user recorded something in the app nobody has
    // analyzed. Notes are inline so noticing them costs no extra call; images
    // still need get_pending_captures, because they are heavy.
    pending_captures: {
      count: pending.length,
      items: pending.map((c) => ({
        capture_id: c.id,
        kind: c.kind,
        note: c.note,
        has_image: c.object_key !== null,
        days_ago: daysBetween(c.local_date, today),
      })),
    },

    training: {
      today: view.today,
      next_lift: view.next_lift,
      no_plan_set: view.empty,
      last_session: lastWorkout
        ? { local_date: lastWorkout, days_ago: daysBetween(lastWorkout, today) }
        : null,
      recent_sessions: sessions.map((w) => ({
        workout_id: w.id,
        local_date: w.local_date,
        session_label: w.session_label,
        sets: w.set_count,
      })),
      plan: plan.map((d) => ({ ...d, weekday_name: WEEKDAY_NAMES[d.weekday] })),
    },

    week: {
      days_with_data: dayTotals.length,
      days_in_window: 7,
      avg_kcal: avg((t) => t.kcal),
      avg_protein_g: avg((t) => t.protein_g),
      avg_alcohol_g: avg((t) => t.alcohol_g),
      // Say it plainly rather than letting a two-day average pass as a week.
      data_quality: dayTotals.length >= 5 ? 'good' : dayTotals.length >= 3 ? 'thin' : 'sparse',
    },

    bodyweight: {
      latest: latest ? { local_date: latest.local_date, weight_lb: latest.weight_lb } : null,
      readings_30d: weights.length,
      target_lb: goals?.target_weight_lb ?? null,
    },

    known_portions: portions.map((p) => ({
      phrase: p.phrase,
      kcal: p.kcal,
      protein_g: p.protein_g,
      times_used: p.times_used,
    })),

    note:
      'Everything needed to orient, in one call. Follow up with the specific tool only when you need more than this: get_last_performance before recommending a load, list_recipes for what to cook, get_pending_captures to actually SEE a photo.',
  };
}
