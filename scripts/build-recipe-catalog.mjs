#!/usr/bin/env node
/**
 * Compile the recipe cards into a catalog the Worker can bundle.
 *
 *   node scripts/build-recipe-catalog.mjs
 *   -> apps/server/src/generated/recipes.json
 *
 * The cards stay the single source of truth. Nutrition lives in each card's
 * schema.org/Recipe JSON-LD, so a recipe and its macros can never drift apart —
 * there is no second file to forget to update.
 *
 * Output is generated and gitignored. It is rebuilt on deploy; recipes change at
 * the speed of commits, so bundling beats a database table and a sync step.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Overridable so the parser can be exercised against fixtures without
// inventing nutrition for a real card.
const RECIPE_DIR = process.env.RECIPE_DIR ?? 'content/recipes';
const OUT = process.env.RECIPE_CATALOG_OUT ?? 'apps/server/src/generated/recipes.json';

/** "780 kcal" -> 780. Returns null for anything without a leading number. */
function amount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /-?\d+(\.\d+)?/.exec(v);
  return m ? Number(m[0]) : null;
}

/** "8 servings" / "2 – 3" -> the number a serving was divided by. Rule 3 in
 *  RECIPE_FORMAT.md says a range resolves to its larger end. */
function servings(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const nums = [...v.matchAll(/\d+(\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? Math.max(...nums) : null;
}

function recipeNode(source) {
  for (const m of source.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      return { error: 'JSON-LD block is not valid JSON' };
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (node?.['@type'] === 'Recipe') return { node };
    }
  }
  return { missing: true };
}

const files = readdirSync(RECIPE_DIR).filter((f) => f.endsWith('.html')).sort();

const recipes = [];
const skipped = [];
let failed = 0;

for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const source = readFileSync(join(RECIPE_DIR, file), 'utf8');
  const { node, missing, error } = recipeNode(source);

  if (error) {
    console.error(`FAIL  ${file}: ${error}`);
    failed++;
    continue;
  }
  if (missing) {
    skipped.push(slug);
    continue;
  }

  const n = node.nutrition ?? {};
  const kcal = amount(n.calories);
  const protein = amount(n.proteinContent);
  const fat = amount(n.fatContent);
  const carb = amount(n.carbohydrateContent);

  // A partial nutrition block is a bug, not a degraded recipe — logging a meal
  // with a missing macro silently records it as zero.
  const missingFields = [
    ['calories', kcal],
    ['proteinContent', protein],
    ['fatContent', fat],
    ['carbohydrateContent', carb],
  ]
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (missingFields.length) {
    console.error(`FAIL  ${file}: nutrition is missing ${missingFields.join(', ')}`);
    failed++;
    continue;
  }

  // Atwater cross-check: protein and carbs at 4 kcal/g, fat at 9. If the stated
  // calories and the stated macros disagree badly, one of them is a typo — and
  // a meal logged from this card would carry the error into the trend data.
  const atwater = protein * 4 + fat * 9 + carb * 4;
  const drift = kcal > 0 ? Math.abs(atwater - kcal) / kcal : 0;
  if (drift > 0.1) {
    console.error(
      `FAIL  ${file}: ${kcal} kcal stated but macros imply ${Math.round(atwater)} ` +
        `(${(drift * 100).toFixed(1)}% apart)`,
    );
    failed++;
    continue;
  }
  if (drift > 0.05) {
    console.warn(
      `warn  ${file}: ${kcal} kcal stated, macros imply ${Math.round(atwater)} ` +
        `(${(drift * 100).toFixed(1)}% apart)`,
    );
  }

  recipes.push({
    slug,
    title: node.name ?? slug,
    servings: servings(node.recipeYield),
    serving_size: n.servingSize ?? '1 serving',
    per_serving: {
      kcal,
      protein_g: protein,
      fat_g: fat,
      carb_g: carb,
      fiber_g: amount(n.fiberContent),
    },
    components: Array.isArray(node['x-components'])
      ? node['x-components'].map((c) => ({
          name: c.name ?? 'component',
          kcal: amount(c.calories),
          protein_g: amount(c.proteinContent),
          fat_g: amount(c.fatContent),
          carb_g: amount(c.carbohydrateContent),
        }))
      : [],
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ recipes }, null, 1) + '\n', 'utf8');

console.log(`${recipes.length} recipe(s) in the catalog -> ${OUT}`);
if (skipped.length) {
  // Not an error: a card without nutrition is simply not loggable yet. Naming
  // them keeps the gap visible instead of silently shipping a short catalog.
  console.log(`${skipped.length} card(s) have no nutrition block and were skipped:`);
  for (const s of skipped) console.log(`        - ${s}`);
}
if (failed > 0) {
  console.error(`\n${failed} card(s) have a broken nutrition block.`);
  process.exit(1);
}
