import type { Ctx } from '../../db/queries.ts';
import { getMealsForRange, getGoalsAsOf } from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import { nextMeal } from '../../domain/mealtimes.ts';
import { localDate, shiftDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { optNumber } from './args.ts';

/**
 * Shape for "what am I eating next" — facts only. The typical time comes from
 * the user's own same-day logs; the budget comes from today's totals. What to
 * actually eat is a judgement and belongs in the Skill.
 */
export async function getNextMeal(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const days = Math.min(Math.max(optNumber(args, 'days') ?? 30, 7), 90);
  const today = localDate(ctx.now, ctx.tz);

  const history = await getMealsForRange(ctx, shiftDate(today, -(days - 1)), today);
  const todays = history.filter((m) => m.local_date === today);
  const totals = sumMeals(todays);
  const goals = await getGoalsAsOf(ctx, today);

  const shaped = nextMeal(
    history.map((m) => ({
      local_date: m.local_date,
      logged_at: m.logged_at,
      meal_type: m.meal_type,
    })),
    ctx.now,
    ctx.tz,
  );

  return {
    now: { local_date: today, local_time: new Intl.DateTimeFormat('en-GB', {
      timeZone: ctx.tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(ctx.now), timezone: ctx.tz },
    next_meal: shaped.next,
    pattern: shaped.pattern,
    usable_logs: shaped.usable_logs,
    // Populated only when next_meal is null, so the answer can say why rather
    // than inventing a mealtime.
    unavailable_because: shaped.reason,
    remaining: remainingVsGoals(totals, goals),
    goals_set: goals !== null,
    eaten_today: { kcal: totals.kcal, protein_g: totals.protein_g },
    meals_today: todays.length,
  };
}
