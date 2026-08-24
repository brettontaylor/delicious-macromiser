import type { Ctx } from '../../db/queries.ts';
import { getMealsForDate, getGoalsAsOf, getLastWorkoutDate, lookupPortions, countPendingCaptures, getMealsForRange } from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import { localWeekday, localTime, daysBetween, shiftDate } from '../../util/date.ts';
import { pace } from '../../domain/pacing.ts';
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

  // Everything in one round of queries. These were sequential and cost ~450ms
  // of pure waiting for no reason — D1 round trips add up fast when a chat is
  // waiting on the answer.
  const [meals, goals, lastWorkout, portions, pending, history] = await Promise.all([
    getMealsForDate(ctx, date),
    getGoalsAsOf(ctx, date),
    getLastWorkoutDate(ctx),
    lookupPortions(ctx, 15),
    countPendingCaptures(ctx),
    getMealsForRange(ctx, shiftDate(date, -29), shiftDate(date, -1)),
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
      recipe_slug: m.recipe_slug ?? null,
      // Exposed so the hour a meal landed is answerable at all. It has been in
      // the table since 0001_init and nothing ever returned it.
      logged_at: m.logged_at,
    })),
    totals,
    goals,
    remaining: remainingVsGoals(totals, goals),
    // Where today sits against the same clock time on past days. "100 g by
    // 2pm" only means something next to "you are usually at 60 by now".
    pace: pace(meals, history, ctx.now, ctx.tz, date),
    goals_set: goals !== null,
    last_workout: lastWorkout
      ? { local_date: lastWorkout, days_ago: daysBetween(lastWorkout, date) }
      : null,
    // Phrases the user has already corrected. Reuse these figures rather than
    // re-estimating the same food; a correction should only be needed once.
    // Above zero means the user recorded something in the app that still needs
    // analyzing. Call get_pending_captures and offer to work through them.
    pending_captures: pending,
    known_portions: portions.map((p) => ({
      phrase: p.phrase,
      kcal: p.kcal,
      protein_g: p.protein_g,
      fat_g: p.fat_g,
      carb_g: p.carb_g,
      times_used: p.times_used,
    })),
    // Both numbers, always. The Skill decides when the gap is worth mentioning.
    alcohol_note:
      totals.alcohol_g > 0
        ? `${totals.alcohol_kcal} of ${totals.kcal} kcal came from alcohol; food kcal is ${totals.food_kcal}.`
        : null,
  };
}
