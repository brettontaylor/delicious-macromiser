/**
 * The recipe catalog, compiled from content/recipes at build time by
 * scripts/build-recipe-catalog.mjs and bundled into the Worker.
 *
 * Bundled rather than stored in D1 on purpose: recipes change at the speed of
 * commits, so a table would add a sync step that can drift from the cards
 * without anyone noticing. The card stays the single source of truth.
 */

import catalog from '../generated/recipes.json' with { type: 'json' };

export interface RecipeComponent {
  name: string;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
}

export interface Recipe {
  slug: string;
  /** Normalised ingredient names, scraped from the card's own list at build
   *  time. Used for pantry matching; the card stays the source of truth. */
  ingredients: string[];
  title: string;
  servings: number | null;
  serving_size: string;
  per_serving: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carb_g: number;
    fiber_g: number | null;
  };
  components: RecipeComponent[];
}

export const RECIPES: Recipe[] = (catalog as { recipes: Recipe[] }).recipes;

const BY_SLUG = new Map(RECIPES.map((r) => [r.slug, r]));

export function findRecipe(slug: string): Recipe | null {
  return BY_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

/** Scale a recipe's per-serving macros. Rounded to whole numbers — the
 *  underlying figures are estimates and false precision reads as certainty. */
export function scaleServings(r: Recipe, servings: number) {
  const s = r.per_serving;
  const round = (v: number) => Math.round(v * servings * 10) / 10;
  return {
    kcal: Math.round(s.kcal * servings),
    protein_g: round(s.protein_g),
    fat_g: round(s.fat_g),
    carb_g: round(s.carb_g),
    fiber_g: s.fiber_g === null ? null : round(s.fiber_g),
  };
}
