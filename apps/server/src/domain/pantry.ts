/**
 * Matching a recipe's ingredients against what is in the house.
 *
 * Substring matching in both directions, which sounds crude and is exactly
 * right for this data. A pantry entry of "chicken" should satisfy "bone-in,
 * skin-on chicken breasts", and an entry of "extra-virgin olive oil" should
 * satisfy "olive oil". Anything cleverer would need an ingredient ontology, and
 * the cost of a wrong match here is that someone opens the fridge and sees.
 *
 * Returns counts and lists — never a verdict. "Makeable" is a judgement that
 * depends on how much the cook feels like improvising, and it belongs in the
 * Skill.
 */

export interface PantryEntry {
  item: string;
  kind: string;
}

export interface RecipeMatch {
  have: string[];
  missing: string[];
  /** 0-1. Reported so a caller can rank without re-deriving it. */
  coverage: number;
}

// Words that carry no identity. Without this "chicken or beef" would match
// anything sharing an "or".
const STOP = new Set(['of', 'or', 'and', 'the', 'a', 'in', 'with', 'for']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function matches(ingredient: string, pantryItem: string): boolean {
  const a = ingredient.toLowerCase();
  const b = pantryItem.toLowerCase();
  if (a === b) return true;
  // Plain substring, either direction: "olive oil" against a pantry entry of
  // "extra-virgin olive oil".
  if (a.includes(b) || b.includes(a)) return true;

  // Token containment, so a word inserted in the middle does not break the
  // match — "ground chicken" in the pantry should satisfy a card that says
  // "ground heritage chicken". Every word of the shorter phrase must appear in
  // the longer one; the shorter is the more general name, and generality is
  // what makes a pantry entry useful.
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.some((u) => u === t || u.includes(t) || t.includes(u)));
}

export function matchRecipe(ingredients: string[], pantry: PantryEntry[]): RecipeMatch {
  const have: string[] = [];
  const missing: string[] = [];

  for (const ing of ingredients) {
    if (pantry.some((p) => matches(ing, p.item))) have.push(ing);
    else missing.push(ing);
  }

  return {
    have,
    missing,
    coverage: ingredients.length === 0 ? 0 : have.length / ingredients.length,
  };
}

/** Items in the pantry that no recipe in the catalog uses — the honest answer
 *  to "what am I going to do with this", and a cheap prompt to add a recipe. */
export function unusedPantry(pantry: PantryEntry[], allIngredients: string[]): string[] {
  return pantry
    .filter((p) => !allIngredients.some((ing) => matches(ing, p.item)))
    .map((p) => p.item);
}
