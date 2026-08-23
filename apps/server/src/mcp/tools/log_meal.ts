import type { Ctx } from '../../db/queries.ts';
import { insertMeal, getMealsForDate, getGoalsAsOf } from '../../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../../domain/totals.ts';
import type { ToolArgs } from './index.ts';
import { reqString, reqNumber, optNumber, optNonNegative, reqEnum, optEnum, resolveWhen, ArgError, optString } from './args.ts';
import { findRecipe, scaleServings } from '../../domain/recipes.ts';
import { getCaptureById, resolveCaptureRow } from '../../db/queries.ts';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;
// 'barcode' and 'corrected' are set by the server, never by the caller:
// 'corrected' belongs to the Phase 3 correction UI, 'barcode' to a scanner.
const CALLER_SOURCES = ['estimate', 'import'] as const;

/**
 * Stores the meal, then returns the updated day so the assistant can report
 * where the user stands without a second round trip.
 */
export async function logMeal(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const when = resolveWhen(args, ctx.now, ctx.tz);
  const slug = optString(args, 'recipe_slug');

  let meal;

  if (slug !== null) {
    // A dish you cooked from a written recipe is the strongest food evidence
    // there is: the portions were measured and written down. Taking the macros
    // from the card rather than the model is the whole point of Phase 2.5 — so
    // any kcal/macros the caller also sent are ignored, not merged.
    const recipe = findRecipe(slug);
    if (!recipe) {
      throw new ArgError(
        `NOT SAVED — no recipe "${slug}". Call list_recipes to see the catalog.`,
      );
    }
    const servings = optNumber(args, 'servings') ?? 1;
    if (servings <= 0 || servings > 20) {
      throw new ArgError('"servings" must be greater than 0 and at most 20.');
    }
    const scaled = scaleServings(recipe, servings);

    meal = {
      local_date: when.localDate,
      meal_type: optEnum(args, 'meal_type', MEAL_TYPES),
      description:
        optString(args, 'description') ??
        `${recipe.title} — ${servings} ${servings === 1 ? 'serving' : 'servings'}`,
      kcal: scaled.kcal,
      protein_g: scaled.protein_g,
      fat_g: scaled.fat_g,
      carb_g: scaled.carb_g,
      fiber_g: scaled.fiber_g,
      alcohol_g: optNonNegative(args, 'alcohol_g', 0),
      // Measured portions, so the entry is high confidence by construction —
      // not something the model gets to talk itself down from.
      confidence: 'high',
      source: 'recipe',
      recipe_slug: recipe.slug,
    };
  } else {
    meal = {
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
      source: optEnum(args, 'source', CALLER_SOURCES) ?? 'estimate',
      recipe_slug: null,
    };
  }

  // A capture becomes a meal in ONE call. Splitting it into log_meal +
  // resolve_capture would double the approval prompts the user sees, which is
  // the same friction import_days exists to remove.
  const captureId = optString(args, 'capture_id');
  let capture = null;
  if (captureId !== null) {
    capture = await getCaptureById(ctx, captureId);
    if (!capture) {
      throw new ArgError(`NOT SAVED — no capture with id "${captureId}".`);
    }
    if (capture.state !== 'pending') {
      throw new ArgError(
        `NOT SAVED — that capture is already ${capture.state}. It has been logged once; do not log it twice.`,
      );
    }
  }

  const id = await insertMeal(ctx, { ...meal, capture_id: captureId });

  let captureResolved = false;
  if (captureId !== null) {
    captureResolved = await resolveCaptureRow(ctx, captureId, 'logged', { mealId: id });
  }

  const meals = await getMealsForDate(ctx, when.localDate);
  const totals = sumMeals(meals);
  const goals = await getGoalsAsOf(ctx, when.localDate);

  return {
    logged: true,
    meal_id: id,
    capture_id: captureId,
    capture_resolved: captureResolved,
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
      source: meal.source,
      recipe_slug: meal.recipe_slug,
    },
  };
}
