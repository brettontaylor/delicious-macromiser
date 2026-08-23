import type { Ctx } from '../../db/queries.ts';
import { RECIPES } from '../../domain/recipes.ts';
import type { ToolArgs } from './index.ts';
import { optNumber, optString } from './args.ts';
import { getPantry } from '../../db/queries.ts';
import { matchRecipe } from '../../domain/pantry.ts';

/**
 * The cookbook, as data. Returns facts only — which dishes exist and what a
 * serving costs. Deciding what to cook tonight is a judgement, and judgements
 * live in the Skill.
 */
export async function listRecipes(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const q = optString(args, 'query');
  const minProtein = optNumber(args, 'min_protein_g');
  const maxKcal = optNumber(args, 'max_kcal');

  let rows = RECIPES;

  if (q) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter(
      (r) => r.title.toLowerCase().includes(needle) || r.slug.includes(needle),
    );
  }
  if (minProtein !== null) rows = rows.filter((r) => r.per_serving.protein_g >= minProtein);
  if (maxKcal !== null) rows = rows.filter((r) => r.per_serving.kcal <= maxKcal);

  // Pantry matching. Only computed when there is a pantry — otherwise every
  // recipe would report every ingredient missing, which reads like a fault.
  const pantry = await getPantry(ctx);
  const maxMissing = optNumber(args, 'max_missing');
  let matched = rows.map((r) => ({
    recipe: r,
    match: pantry.length > 0 ? matchRecipe(r.ingredients ?? [], pantry) : null,
  }));
  if (maxMissing !== null && pantry.length > 0) {
    matched = matched.filter((m) => (m.match?.missing.length ?? 0) <= maxMissing);
  }
  // Best-covered first when a pantry exists, so the caller does not have to
  // sort to find the near-misses. Still a ranking of FACTS, not a suggestion.
  if (pantry.length > 0) {
    matched.sort((a, b) => (b.match?.coverage ?? 0) - (a.match?.coverage ?? 0));
  }

  return {
    count: matched.length,
    catalog_size: RECIPES.length,
    pantry_known: pantry.length,
    recipes: matched.map(({ recipe: r, match }) => ({
      slug: r.slug,
      title: r.title,
      servings: r.servings,
      serving_size: r.serving_size,
      per_serving: r.per_serving,
      // Components let a serving eaten without the rice still be logged
      // accurately, rather than forcing an all-or-nothing entry.
      components: r.components,
      ingredients: r.ingredients ?? [],
      // Null when no pantry is set up — absent, not "nothing matches".
      have: match?.have ?? null,
      missing: match?.missing ?? null,
      missing_count: match?.missing.length ?? null,
    })),
    note:
      'Log one of these with log_meal using recipe_slug and servings — the macros ' +
      'come from the recipe, so do not estimate them yourself.' +
      (pantry.length === 0
        ? ' No pantry is set up, so have/missing are null rather than empty — do not read that as "nothing in the house".'
        : ' have/missing are against their pantry. Deciding what counts as cookable tonight is your judgement: a missing herb is not a missing protein.'),
  };
}
