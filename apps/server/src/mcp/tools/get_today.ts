import type { Ctx } from '../../db/queries.ts';
import { getMealsForDate, getGoalsAsOf, getLastWorkoutDate } from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import { localWeekday, localTime, daysBetween } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { optLocalDate } from './args.ts';

/**
 * Answers "where am I?" in one call.
 *
 * Returns weekday and local time because the Skill is told to judge whether
 * protein is behind pace for the hour and to check the real calendar before
 * programming — it cannot do either if it has to guess what day it is
 * (COACHING-LAYER.md §3, §4).
 */
export async function getToday(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const date = optLocalDate(args, 'date', ctx.now, ctx.tz);

  const [meals, goals, lastWorkout] = await Promise.all([
    getMealsForDate(ctx, date),
    getGoalsAsOf(ctx, date),
    getLastWorkoutDate(ctx),
  ]);

  const totals = sumMeals(meals);

  return {
    local_date: date,
    weekday: localWeekday(ctx.now, ctx.tz),
    local_time: localTime(ctx.now, ctx.tz),
    timezone: ctx.tz,
    meals: meals.map((m) => ({
      id: m.id,
      meal_type: m.meal_type,
      description: m.description,
      kcal: m.kcal,
      protein_g: m.protein_g,
      fat_g: m.fat_g,
      carb_g: m.carb_g,
      alcohol_g: m.alcohol_g,
      confidence: m.confidence,
      source: m.source,
    })),
    totals,
    goals,
    remaining: remainingVsGoals(totals, goals),
    goals_set: goals !== null,
    last_workout: lastWorkout
      ? { local_date: lastWorkout, days_ago: daysBetween(lastWorkout, date) }
      : null,
    // Both numbers, always. The Skill decides when the gap is worth mentioning.
    alcohol_note:
      totals.alcohol_g > 0
        ? `${totals.alcohol_kcal} of ${totals.kcal} kcal came from alcohol; food kcal is ${totals.food_kcal}.`
        : null,
  };
}
