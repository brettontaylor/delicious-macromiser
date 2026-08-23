#!/usr/bin/env node
/**
 * Recipe conformance check.
 *
 * Two tiers, mirroring the house pattern in DIWINE's check-design-conformance:
 *
 *   ENFORCED — structural guarantees the print format depends on. A failure
 *              here means the card will not render or print correctly, so it
 *              fails the build.
 *   ADVISORY — the schema.org/Recipe JSON-LD block carrying per-serving
 *              nutrition. Reported but not enforced until the recipe catalog
 *              is wired into the MCP server (docs/ROADMAP.md, Phase 2.5).
 *              Flip ENFORCE_NUTRITION to true when the backfill is done.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RECIPE_DIR = 'content/recipes';
const ENFORCE_NUTRITION = false;

// Palette from _template/BASE_TEMPLATE.html. RECIPE_FORMAT.md says these are
// fixed — a recipe that invents its own colors breaks the book's consistency.
const REQUIRED_VARS = ['--cream', '--ink', '--burgundy', '--sienna'];

const ENFORCED = [
  { name: 'has <title>', test: (s) => /<title>\s*\S[^<]*<\/title>/.test(s) },
  { name: 'has <h1> dish title', test: (s) => /<h1[\s>]/.test(s) },
  { name: 'has print button', test: (s) => /class="print-btn/.test(s) },
  { name: 'has @media print rules', test: (s) => /@media\s+print/.test(s) },
  {
    name: 'uses canonical palette vars',
    test: (s) => REQUIRED_VARS.every((v) => s.includes(`${v}:`)),
  },
  {
    // Google Fonts is the one allowed external origin (RECIPE_FORMAT.md).
    // Anything else breaks the "self-contained, zero-dependency" guarantee.
    name: 'no external stylesheets except Google Fonts',
    test: (s) =>
      [...s.matchAll(/<link[^>]+rel=["']?stylesheet[^>]*>/gi)].every((m) =>
        m[0].includes('fonts.googleapis.com'),
      ),
  },
];

function nutritionOf(source) {
  for (const m of source.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node?.['@type'] === 'Recipe' && node.nutrition) return node.nutrition;
      }
    } catch {
      return { __parseError: true };
    }
  }
  return null;
}

const files = readdirSync(RECIPE_DIR)
  .filter((f) => f.endsWith('.html'))
  .sort();

if (files.length === 0) {
  console.error(`No recipes found in ${RECIPE_DIR}/`);
  process.exit(1);
}

let failures = 0;
const missingNutrition = [];

for (const file of files) {
  const source = readFileSync(join(RECIPE_DIR, file), 'utf8');
  const failed = ENFORCED.filter((c) => !c.test(source)).map((c) => c.name);

  if (failed.length > 0) {
    failures += failed.length;
    console.error(`FAIL  ${file}`);
    for (const name of failed) console.error(`        - ${name}`);
  } else {
    console.log(`ok    ${file}`);
  }

  const nutrition = nutritionOf(source);
  if (nutrition?.__parseError) {
    failures++;
    console.error(`FAIL  ${file}\n        - JSON-LD block is not valid JSON`);
  } else if (!nutrition) {
    missingNutrition.push(file);
  }
}

console.log(`\n${files.length} recipe(s) checked.`);

if (missingNutrition.length > 0) {
  const label = ENFORCE_NUTRITION ? 'FAIL' : 'advisory';
  console.log(
    `\n${label}: ${missingNutrition.length}/${files.length} lack schema.org/Recipe nutrition ` +
      `(needed before the catalog can feed log_meal — see docs/ROADMAP.md Phase 2.5):`,
  );
  for (const f of missingNutrition) console.log(`        - ${f}`);
  if (ENFORCE_NUTRITION) failures += missingNutrition.length;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll enforced checks passed.');
