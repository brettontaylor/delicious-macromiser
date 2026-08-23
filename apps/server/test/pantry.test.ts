import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecipe, unusedPantry } from '../src/domain/pantry.ts';
import type { PantryEntry } from '../src/domain/pantry.ts';

const p = (...items: string[]): PantryEntry[] => items.map((item) => ({ item, kind: 'staple' }));

test('an exact ingredient is matched', () => {
  const m = matchRecipe(['olive oil', 'kosher salt'], p('olive oil'));
  assert.deepEqual(m.have, ['olive oil']);
  assert.deepEqual(m.missing, ['kosher salt']);
});

test('a broad pantry entry covers a specific ingredient', () => {
  // "chicken" in the house should satisfy the card's full name for it.
  const m = matchRecipe(['bone-in, skin-on chicken breasts'], p('chicken'));
  assert.equal(m.missing.length, 0);
});

test('a specific pantry entry covers a broad ingredient', () => {
  const m = matchRecipe(['olive oil'], p('extra-virgin olive oil'));
  assert.equal(m.missing.length, 0);
});

test('coverage is reported, not a verdict', () => {
  const m = matchRecipe(['a', 'b', 'c', 'd'], p('a', 'b'));
  assert.equal(m.coverage, 0.5);
  assert.ok(!('makeable' in m), 'the domain must not decide what is cookable');
});

test('an empty pantry misses everything rather than throwing', () => {
  const m = matchRecipe(['flour', 'sugar'], []);
  assert.equal(m.have.length, 0);
  assert.equal(m.missing.length, 2);
  assert.equal(m.coverage, 0);
});

test('a recipe with no ingredient list has zero coverage, not division by zero', () => {
  const m = matchRecipe([], p('flour'));
  assert.equal(m.coverage, 0);
  assert.ok(Number.isFinite(m.coverage));
});

test('matching is case-insensitive', () => {
  const m = matchRecipe(['Kosher Salt'], p('kosher salt'));
  assert.equal(m.missing.length, 0);
});

test('unused pantry items are surfaced', () => {
  const unused = unusedPantry(p('anchovies', 'chicken'), ['chicken breasts', 'rice']);
  assert.deepEqual(unused, ['anchovies']);
});

test('a word inserted in the middle does not break the match', () => {
  // "ground chicken" in the house should satisfy a card saying "ground
  // heritage chicken" — plain substring matching misses this.
  const m = matchRecipe(['ground heritage chicken'], p('ground chicken'));
  assert.equal(m.missing.length, 0);
});

test('stop words alone do not create a match', () => {
  const m = matchRecipe(['butter or olive oil'], p('salt and pepper'));
  assert.equal(m.have.length, 0, 'sharing "or"/"and" must not count as a match');
});

test('an unrelated ingredient still misses', () => {
  const m = matchRecipe(['bone-in beef short ribs'], p('ground chicken'));
  assert.equal(m.missing.length, 1);
});
