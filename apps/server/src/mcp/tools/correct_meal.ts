import type { Ctx, MealPatch } from '../../db/queries.ts';
import {
  getMealById,
  updateMeal,
  softDeleteMeal,
  rememberPortion,
  getMealsForDate,
  getGoalsAsOf,
} from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString, optNumber, optEnum } from './args.ts';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

async function dayAfter(ctx: Ctx, date: string) {
  const meals = await getMealsForDate(ctx, date);
  const totals = sumMeals(meals);
  const goals = await getGoalsAsOf(ctx, date);
  return { day_totals: totals, remaining: remainingVsGoals(totals, goals), meals_that_day: meals.length };
}

/**
 * Correct a logged meal.
 *
 * The estimate-then-correct loop is the whole reason `confidence` and `source`
 * exist. An edit always lands as `source='corrected'` and `confidence='high'`:
 * a human has now looked at these numbers, which is a different kind of
 * evidence from anything the model produced on its own.
 *
 * Partial by design — send only the fields that are wrong.
 */
export async function correctMeal(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'meal_id');
  const before = await getMealById(ctx, id);
  if (!before) {
    throw new ArgError(
      `NOT CHANGED — no meal with id "${id}" (it may already be deleted). Call get_today or get_history to find the right id.`,
    );
  }

  const patch: MealPatch = {};
  const num = (key: keyof MealPatch) => {
    const v = optNumber(args, key as string);
    if (v === null) return;
    if (v < 0) throw new ArgError(`"${key}" cannot be negative.`);
    (patch as Record<string, unknown>)[key] = v;
  };
  num('kcal'); num('protein_g'); num('fat_g'); num('carb_g'); num('fiber_g'); num('alcohol_g');

  const desc = optString(args, 'description');
  if (desc !== null) patch.description = desc.trim();
  const mealType = optEnum(args, 'meal_type', MEAL_TYPES);
  if (mealType !== null) patch.meal_type = mealType;

  if (Object.keys(patch).length === 0) {
    throw new ArgError('NOT CHANGED — nothing to change. Send at least one field.');
  }

  const ok = await updateMeal(ctx, id, patch);
  if (!ok) throw new ArgError('NOT CHANGED — the meal could not be updated.');

  const after = await getMealById(ctx, id);

  // Teach the portion. Only when the macros actually moved and there is a
  // description to key on — remembering an unchanged estimate would just
  // enshrine the guess.
  const macrosMoved =
    after !== null &&
    (after.kcal !== before.kcal ||
      after.protein_g !== before.protein_g ||
      after.fat_g !== before.fat_g ||
      after.carb_g !== before.carb_g);

  let remembered: string | null = null;
  if (macrosMoved && after) {
    const phrase = (patch.description ?? before.description).trim();
    if (phrase.length >= 3 && phrase.length <= 120) {
      await rememberPortion(ctx, phrase, {
        kcal: after.kcal,
        protein_g: after.protein_g,
        fat_g: after.fat_g,
        carb_g: after.carb_g,
      });
      remembered = phrase;
    }
  }

  return {
    corrected: true,
    meal_id: id,
    local_date: before.local_date,
    before: {
      description: before.description,
      kcal: before.kcal, protein_g: before.protein_g,
      fat_g: before.fat_g, carb_g: before.carb_g,
      confidence: before.confidence, source: before.source,
    },
    after: after && {
      description: after.description,
      kcal: after.kcal, protein_g: after.protein_g,
      fat_g: after.fat_g, carb_g: after.carb_g,
      confidence: after.confidence, source: after.source,
    },
    // Non-null means the next estimate of this phrase should start here.
    portion_remembered: remembered,
    ...(await dayAfter(ctx, before.local_date)),
  };
}

/**
 * Soft delete. The row stays, so a mistaken delete is recoverable without
 * reaching for a backup, and every read already filters `deleted_at IS NULL`.
 */
export async function deleteMeal(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'meal_id');
  const before = await getMealById(ctx, id);
  if (!before) {
    throw new ArgError(
      `NOT DELETED — no meal with id "${id}" (it may already be deleted).`,
    );
  }
  const ok = await softDeleteMeal(ctx, id);
  if (!ok) throw new ArgError('NOT DELETED — the meal could not be removed.');

  return {
    deleted: true,
    meal_id: id,
    local_date: before.local_date,
    removed: {
      description: before.description,
      kcal: before.kcal,
      protein_g: before.protein_g,
    },
    recoverable: true,
    ...(await dayAfter(ctx, before.local_date)),
  };
}
