import type { Ctx } from '../../db/queries.ts';
import { insertMeal, getMealsForDate, getGoalsAsOf } from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import type { ToolArgs } from './index.ts';
import { reqString, reqNumber, optNumber, optNonNegative, reqEnum, optEnum, resolveWhen } from './args.ts';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;

/**
 * Stores the meal, then returns the updated day so the assistant can report
 * where the user stands without a second round trip.
 */
export async function logMeal(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const when = resolveWhen(args, ctx.now, ctx.tz);

  const meal = {
    local_date: when.localDate,
    meal_type: optEnum(args, 'meal_type', MEAL_TYPES),
    description: reqString(args, 'description'),
    kcal: reqNumber(args, 'kcal'),
    protein_g: reqNumber(args, 'protein_g'),
    fat_g: reqNumber(args, 'fat_g'),
    carb_g: reqNumber(args, 'carb_g'),
    fiber_g: optNumber(args, 'fiber_g'),
    alcohol_g: optNonNegative(args, 'alcohol_g', 0),
    confidence: reqEnum(args, 'confidence', CONFIDENCE),
    source: 'estimate',
  };

  const id = await insertMeal(ctx, meal);

  const meals = await getMealsForDate(ctx, when.localDate);
  const totals = sumMeals(meals);
  const goals = await getGoalsAsOf(ctx, when.localDate);

  return {
    logged: true,
    meal_id: id,
    local_date: when.localDate,
    backdated: when.backdated,
    day_totals: totals,
    remaining: remainingVsGoals(totals, goals),
    goals_set: goals !== null,
    meals_today: meals.length,
    // Surfaced so the assistant repeats the estimate back and invites a correction.
    stored_estimate: {
      description: meal.description,
      kcal: meal.kcal,
      protein_g: meal.protein_g,
      fat_g: meal.fat_g,
      carb_g: meal.carb_g,
      alcohol_g: meal.alcohol_g,
      confidence: meal.confidence,
    },
  };
}
