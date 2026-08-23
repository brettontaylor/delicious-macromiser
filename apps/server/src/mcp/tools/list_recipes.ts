import type { Ctx } from '../../db/queries.ts';
import { RECIPES } from '../../domain/recipes.ts';
import type { ToolArgs } from './index.ts';
import { optNumber, optString } from './args.ts';

/**
 * The cookbook, as data. Returns facts only — which dishes exist and what a
 * serving costs. Deciding what to cook tonight is a judgement, and judgements
 * live in the Skill.
 */
export async function listRecipes(_ctx: Ctx, args: ToolArgs): Promise<unknown> {
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

  return {
    count: rows.length,
    catalog_size: RECIPES.length,
    recipes: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      servings: r.servings,
      serving_size: r.serving_size,
      per_serving: r.per_serving,
      // Components let a serving eaten without the rice still be logged
      // accurately, rather than forcing an all-or-nothing entry.
      components: r.components,
    })),
    note:
      'Log one of these with log_meal using recipe_slug and servings — the macros ' +
      'come from the recipe, so do not estimate them yourself.',
  };
}
