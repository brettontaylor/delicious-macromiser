/**
 * The recipe book, on the phone.
 *
 * `list_recipes` gave the model the catalog and gave the cook nothing — "what
 * can I make tonight" still meant opening a chat. This is the same data with a
 * thumb-sized interface: what fits the remaining budget, what is nearly in the
 * house, and what is missing.
 *
 * Read-only and available to both capabilities. It exposes the recipe book and
 * the pantry, neither of which is sensitive the way the food log is.
 */

import type { Ctx } from '../db/queries.ts';
import { getMealsForDate, getGoalsAsOf, getPantry } from '../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../domain/totals.ts';
import { RECIPES } from '../domain/recipes.ts';
import { matchRecipe } from '../domain/pantry.ts';
import { localDate } from '../util/date.ts';
import { PAGE_CSS, esc, shell } from './layout.ts';

export async function renderRecipes(ctx: Ctx, secret: string): Promise<Response> {
  const today = localDate(ctx.now, ctx.tz);
  const [meals, goals, pantry] = await Promise.all([
    getMealsForDate(ctx, today),
    getGoalsAsOf(ctx, today),
    getPantry(ctx),
  ]);
  const remaining = remainingVsGoals(sumMeals(meals), goals);

  const rows = RECIPES.map((r) => {
    const match = pantry.length > 0 ? matchRecipe(r.ingredients ?? [], pantry) : null;
    const fits = remaining.kcal === null ? null : r.per_serving.kcal <= remaining.kcal;
    return { r, match, fits };
  }).sort((a, b) => {
    // What fits the budget first, then best-covered by the pantry. Both are
    // facts; the cook still decides.
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    return (b.match?.coverage ?? 0) - (a.match?.coverage ?? 0);
  });

  const body = `
  <div class="bar">
    <a class="back" href="/app/${esc(secret)}">&larr; Today</a>
    <span class="ro">Recipes</span>
  </div>

  <div>
    <h1 class="date">The book</h1>
    <p class="sub">${RECIPES.length} recipes${
      remaining.kcal !== null ? ` · ${Math.round(remaining.kcal)} kcal left today` : ''
    }${pantry.length > 0 ? ` · ${pantry.length} things in the kitchen` : ''}</p>
  </div>

  ${
    pantry.length === 0
      ? `<div class="empty">No pantry set up yet. Tell your coach what you always have and what is fresh, and this page will show what is nearly cookable.</div>`
      : ''
  }

  ${rows
    .map(
      ({ r, match, fits }) => `
    <article class="card recipe">
      <div class="r-head">
        <span class="r-title">${esc(r.title)}</span>
        ${fits === false ? '<span class="chip">over budget</span>' : ''}
      </div>
      <div class="nums">
        <span><b>${r.per_serving.kcal}</b> kcal</span>
        <span>P <b>${r.per_serving.protein_g}</b></span>
        <span>C <b>${r.per_serving.carb_g}</b></span>
        <span>F <b>${r.per_serving.fat_g}</b></span>
        ${r.servings ? `<span>serves <b>${r.servings}</b></span>` : ''}
      </div>
      ${
        match
          ? `<div class="r-cover">
              <div class="bar-t"><i style="width:${(match.coverage * 100).toFixed(0)}%"></i></div>
              <span class="r-have">${match.have.length}/${
                match.have.length + match.missing.length
              } on hand</span>
            </div>
            ${
              match.missing.length > 0
                ? `<details class="r-missing"><summary>${match.missing.length} to buy</summary>
                    <p>${match.missing.map((m) => esc(m)).join(' · ')}</p></details>`
                : '<p class="r-all">Everything on hand.</p>'
            }`
          : ''
      }
    </article>`,
    )
    .join('')}

  <footer>
    Per-serving figures come from each card's own ingredient list. What is
    actually cookable is your call — a missing herb is not a missing protein.
  </footer>`;

  return shell(`Recipes — macromiser`, PAGE_CSS + RECIPE_CSS, body);
}

const RECIPE_CSS = `
.back{font-size:13px;color:var(--ink);text-decoration:none}
.back:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.recipe{gap:10px}
.r-head{display:flex;align-items:baseline;gap:8px}
.r-title{font-family:var(--display);font-size:17px;font-weight:600}
.r-head .chip{margin-left:auto}
.r-cover{display:flex;align-items:center;gap:10px}
.r-cover .bar-t{flex:1}
.r-have{font-family:var(--mono);font-size:11px;color:var(--muted);white-space:nowrap}
.r-missing summary{cursor:pointer;font-family:var(--mono);font-size:11px;color:var(--muted)}
.r-missing p{margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.5}
.r-all{margin:0;font-family:var(--mono);font-size:11px;color:var(--ink)}
`;
