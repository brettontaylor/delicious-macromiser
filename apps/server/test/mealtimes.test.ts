import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMeal, minutesToClock, clockToMinutes } from '../src/domain/mealtimes.ts';
import type { TimedMeal } from '../src/domain/mealtimes.ts';

const TZ = 'America/New_York';

/** A meal logged on the same day it was eaten — the only kind that teaches a time. */
function live(date: string, localHHMM: string, meal_type: string): TimedMeal {
  // New York is UTC-4 in August. Building the UTC instant this way keeps the
  // test readable in local terms rather than in offsets.
  const [h, m] = localHHMM.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCHours(h! + 4, m!, 0, 0);
  return { local_date: date, logged_at: utc.toISOString(), meal_type };
}

const AUG = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'];

test('clock helpers round-trip', () => {
  assert.equal(minutesToClock(clockToMinutes('12:40')), '12:40');
  assert.equal(minutesToClock(0), '00:00');
  assert.equal(minutesToClock(1439), '23:59');
});

test('a consistent lunch habit predicts that lunch', () => {
  const meals = AUG.map((d) => live(d, '12:30', 'lunch'));
  const at = new Date('2026-08-21T14:00:00Z'); // 10:00 local, before lunch
  const r = nextMeal(meals, at, TZ);
  assert.equal(r.next?.meal_type, 'lunch');
  assert.equal(r.next?.typical_time, '12:30');
  assert.equal(r.next?.tomorrow, false);
  assert.equal(r.next?.observations, 4);
});

test('the median ignores one wildly late meal', () => {
  const meals = [
    ...AUG.map((d) => live(d, '12:30', 'lunch')),
    live('2026-08-21', '17:45', 'lunch'),
  ];
  const at = new Date('2026-08-22T14:00:00Z'); // 10:00 local
  const r = nextMeal(meals, at, TZ);
  assert.equal(r.next?.typical_time, '12:30', 'an outlier must not drag the estimate');
});

test('after the last slot, the next meal is tomorrow', () => {
  const meals = [
    ...AUG.map((d) => live(d, '08:00', 'breakfast')),
    ...AUG.map((d) => live(d, '19:00', 'dinner')),
  ];
  const at = new Date('2026-08-22T03:00:00Z'); // 23:00 local, after dinner
  const r = nextMeal(meals, at, TZ);
  assert.equal(r.next?.meal_type, 'breakfast');
  assert.equal(r.next?.tomorrow, true);
});

test('slots come back in day order, not insertion order', () => {
  const meals = [
    ...AUG.map((d) => live(d, '19:00', 'dinner')),
    ...AUG.map((d) => live(d, '08:00', 'breakfast')),
    ...AUG.map((d) => live(d, '12:30', 'lunch')),
  ];
  const r = nextMeal(meals, new Date('2026-08-22T09:00:00Z'), TZ);
  assert.deepEqual(
    r.pattern.map((p) => p.meal_type),
    ['breakfast', 'lunch', 'dinner'],
  );
});

test('backfilled meals teach nothing — they carry the time they were written', () => {
  // Logged on 2026-08-22 but belonging to earlier days: an import.
  const imported: TimedMeal[] = AUG.map((d) => ({
    local_date: d,
    logged_at: '2026-08-22T18:00:00Z',
    meal_type: 'lunch',
  }));
  const r = nextMeal(imported, new Date('2026-08-23T14:00:00Z'), TZ);
  assert.equal(r.next, null);
  assert.equal(r.usable_logs, 0);
  assert.match(r.reason ?? '', /imported history/);
});

test('two observations is not a habit', () => {
  const meals = AUG.slice(0, 2).map((d) => live(d, '12:30', 'lunch'));
  const r = nextMeal(meals, new Date('2026-08-21T14:00:00Z'), TZ);
  assert.equal(r.next, null);
  assert.equal(r.usable_logs, 2);
  assert.match(r.reason ?? '', /Not enough history/);
});

test('meals with no meal_type are ignored rather than guessed at', () => {
  const meals = AUG.map((d) => live(d, '12:30', 'lunch'));
  meals.push(...AUG.map((d) => ({ ...live(d, '15:00', 'lunch'), meal_type: null })));
  const r = nextMeal(meals, new Date('2026-08-21T14:00:00Z'), TZ);
  assert.equal(r.next?.typical_time, '12:30');
  assert.equal(r.next?.observations, 4);
});

test('an empty log explains itself instead of going blank', () => {
  const r = nextMeal([], new Date('2026-08-21T14:00:00Z'), TZ);
  assert.equal(r.next, null);
  assert.equal(r.pattern.length, 0);
  assert.match(r.reason ?? '', /No meals logged/);
});

test('spread reports how tight the habit is', () => {
  const meals = [
    live('2026-08-17', '12:00', 'lunch'),
    live('2026-08-18', '12:20', 'lunch'),
    live('2026-08-19', '12:40', 'lunch'),
    live('2026-08-20', '13:00', 'lunch'),
  ];
  const r = nextMeal(meals, new Date('2026-08-21T14:00:00Z'), TZ);
  assert.ok(r.next!.spread_min > 0, 'a varied habit should report a non-zero spread');
  assert.ok(r.next!.spread_min < 60, 'and a 1-hour band should not read as an hour of spread');
});
