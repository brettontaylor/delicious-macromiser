/**
 * Unit tests for the pure domain layer. No Worker, no D1 — these run on plain
 * Node (`npm test`) because the arithmetic is where a wrong answer is silent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sumMeals, remainingVsGoals, summarizeWeek, KCAL_PER_G_ALCOHOL } from '../src/domain/totals.ts';
import type { MealRow } from '../src/domain/totals.ts';
import { normalizeExercise, movementPattern, slugify } from '../src/domain/exercise.ts';
import { buildHistory } from '../src/domain/progression.ts';
import type { SetRow } from '../src/domain/progression.ts';
import { localDate, shiftDate, dateRange, daysBetween, isValidDate } from '../src/util/date.ts';

const meal = (over: Partial<MealRow> = {}): MealRow => ({
  id: 'm1',
  local_date: '2026-08-22',
  meal_type: 'dinner',
  description: 'test',
  kcal: 500,
  protein_g: 40,
  fat_g: 20,
  carb_g: 35,
  fiber_g: 5,
  alcohol_g: 0,
  confidence: 'medium',
  source: 'estimate',
  logged_at: '2026-08-22T18:00:00.000Z',
  ...over,
});

// ---------- alcohol separation: the schema decision worth defending ----------

test('alcohol is separated from food calories, never folded into carbs', () => {
  // The README's own example: a 2,100 kcal day with 520 from wine.
  const wineKcal = 520;
  const t = sumMeals([
    meal({ kcal: 1580, alcohol_g: 0 }),
    meal({ id: 'm2', kcal: wineKcal, protein_g: 0, fat_g: 0, carb_g: 0, alcohol_g: wineKcal / KCAL_PER_G_ALCOHOL }),
  ]);
  assert.equal(t.kcal, 2100);
  assert.equal(t.alcohol_kcal, 520);
  assert.equal(t.food_kcal, 1580);
  // Ethanol must not have inflated carbs.
  assert.equal(t.carb_g, 35);
});

test('food_kcal never goes negative on a mis-entered alcohol_g', () => {
  const t = sumMeals([meal({ kcal: 100, alcohol_g: 500 })]);
  assert.equal(t.food_kcal, 0);
});

test('empty day sums to zero rather than NaN', () => {
  const t = sumMeals([]);
  assert.equal(t.kcal, 0);
  assert.equal(t.food_kcal, 0);
});

test('null fiber_g does not poison the total', () => {
  const t = sumMeals([meal({ fiber_g: null }), meal({ id: 'm2', fiber_g: 7 })]);
  assert.equal(t.fiber_g, 7);
});

// ---------- remaining vs goals ----------

test('remaining is null for macros with no goal, not zero', () => {
  const t = sumMeals([meal()]);
  const r = remainingVsGoals(t, { kcal: 2300, protein_g: null, fat_g: null, carb_g: null, target_weight_lb: null, weekly_sessions: null });
  assert.equal(r.kcal, 1800);
  assert.equal(r.protein_g, null);
});

test('remaining goes negative when the goal is exceeded', () => {
  const t = sumMeals([meal({ kcal: 2500 })]);
  const r = remainingVsGoals(t, { kcal: 2300, protein_g: 170, fat_g: null, carb_g: null, target_weight_lb: null, weekly_sessions: null });
  assert.equal(r.kcal, -200);
});

test('no goals at all yields all-null remaining', () => {
  const r = remainingVsGoals(sumMeals([meal()]), null);
  assert.deepEqual(r, { kcal: null, protein_g: null, fat_g: null, carb_g: null });
});

// ---------- week summary ----------

test('averages divide by days with data, not by the window length', () => {
  // 3 logged days in a 7-day window. Dividing by 7 would report a fake deficit.
  const byDate = new Map<string, MealRow[]>([
    ['2026-08-16', [meal({ kcal: 2000, protein_g: 180 })]],
    ['2026-08-17', [meal({ kcal: 2200, protein_g: 160 })]],
    ['2026-08-18', [meal({ kcal: 2400, protein_g: 200 })]],
  ]);
  const window = dateRange('2026-08-16', '2026-08-22');
  const s = summarizeWeek(byDate, window, { kcal: 2300, protein_g: 170, fat_g: null, carb_g: null, target_weight_lb: null, weekly_sessions: null }, [], 2);

  assert.equal(s.days_with_data, 3);
  assert.equal(s.days_in_window, 7);
  assert.equal(s.avg_kcal, 2200);
  // 2 of 3 logged days hit 170g protein.
  assert.equal(s.protein_adherence_pct, 67);
  assert.equal(s.sessions, 2);
});

test('a window with no data reports nulls, not zeros', () => {
  const s = summarizeWeek(new Map(), dateRange('2026-08-16', '2026-08-22'), null, [], 0);
  assert.equal(s.days_with_data, 0);
  assert.equal(s.avg_kcal, null);
  assert.equal(s.protein_adherence_pct, null);
});

test('protein adherence is null when no protein goal is set', () => {
  const byDate = new Map<string, MealRow[]>([['2026-08-16', [meal()]]]);
  const s = summarizeWeek(byDate, dateRange('2026-08-16', '2026-08-22'), { kcal: 2300, protein_g: null, fat_g: null, carb_g: null, target_weight_lb: null, weekly_sessions: null }, [], 0);
  assert.equal(s.protein_adherence_pct, null);
});

// ---------- exercise normalization ----------

test('exercise aliases collapse to one history key', () => {
  for (const raw of ['squat', 'Squats', 'back squat', 'Barbell Back Squat', 'BACK_SQUAT']) {
    assert.equal(normalizeExercise(raw), 'back_squat', `failed for ${raw}`);
  }
  assert.equal(normalizeExercise('bench'), 'bench_press');
  assert.equal(normalizeExercise('RDL'), 'romanian_deadlift');
  assert.equal(normalizeExercise('pull-ups'), 'pull_up');
});

test('an unknown lift still gets a stable slug', () => {
  assert.equal(normalizeExercise('Zercher Carry'), 'zercher_carry');
  assert.equal(normalizeExercise('Zercher  carry!'), 'zercher_carry');
});

test('slugify strips punctuation and edge underscores', () => {
  assert.equal(slugify('  Bench Press!! '), 'bench_press');
  assert.equal(slugify('---'), '');
});

test('movement patterns drive the recovery rules', () => {
  assert.equal(movementPattern('back_squat'), 'squat');
  assert.equal(movementPattern('romanian_deadlift'), 'hinge');
  assert.equal(movementPattern('bench_press'), 'horizontal_push');
  assert.equal(movementPattern('overhead_press'), 'vertical_push');
  assert.equal(movementPattern('barbell_row'), 'horizontal_pull');
  assert.equal(movementPattern('pull_up'), 'vertical_pull');
});

// ---------- progression shaping ----------

const setRow = (over: Partial<SetRow>): SetRow => ({
  exercise: 'back_squat',
  exercise_raw: 'squat',
  set_no: 1,
  reps: 6,
  weight_lb: 205,
  rpe: 7,
  completed: 1,
  local_date: '2026-08-20',
  session_label: 'Day A',
  ...over,
});

test('the ROADMAP exit criterion: 205 x 6 x 4 comes back as the last session', () => {
  const rows = [1, 2, 3, 4].map((n) => setRow({ set_no: n }));
  const h = buildHistory('back_squat', rows, '2026-08-22');

  assert.equal(h.sessions_logged, 1);
  assert.equal(h.last?.sets.length, 4);
  assert.equal(h.last?.top_set?.weight_lb, 205);
  assert.equal(h.last?.top_set?.reps, 6);
  assert.equal(h.last?.all_sets_completed, true);
  assert.equal(h.last?.days_ago, 2);
  assert.equal(h.last?.volume_lb, 4920); // 4 x 6 x 205
});

test('sessions are grouped by date and returned newest first', () => {
  const rows = [
    setRow({ local_date: '2026-08-13', weight_lb: 195 }),
    setRow({ local_date: '2026-08-20', weight_lb: 205 }),
    setRow({ local_date: '2026-08-06', weight_lb: 185 }),
  ];
  const h = buildHistory('back_squat', rows, '2026-08-22');
  assert.equal(h.sessions_logged, 3);
  assert.equal(h.last?.local_date, '2026-08-20');
  assert.deepEqual(h.previous.map((p) => p.local_date), ['2026-08-13', '2026-08-06']);
});

test('previous is capped at three sessions', () => {
  const rows = ['2026-08-20', '2026-08-13', '2026-08-06', '2026-07-30', '2026-07-23'].map((d) =>
    setRow({ local_date: d }),
  );
  const h = buildHistory('back_squat', rows, '2026-08-22');
  assert.equal(h.previous.length, 3);
});

test('a missed set blocks all_sets_completed', () => {
  const rows = [
    setRow({ set_no: 1 }),
    setRow({ set_no: 2, reps: 4, completed: 0 }),
  ];
  const h = buildHistory('back_squat', rows, '2026-08-22');
  assert.equal(h.last?.all_sets_completed, false);
  // A missed set contributes no volume and cannot be the top set.
  assert.equal(h.last?.volume_lb, 1230);
});

test('top set prefers more reps at equal load', () => {
  const rows = [
    setRow({ set_no: 1, weight_lb: 205, reps: 5 }),
    setRow({ set_no: 2, weight_lb: 205, reps: 8 }),
  ];
  const h = buildHistory('back_squat', rows, '2026-08-22');
  assert.equal(h.last?.top_set?.reps, 8);
});

test('bodyweight movements with no load still shape a session', () => {
  const rows = [setRow({ exercise: 'pull_up', weight_lb: null, reps: 10 })];
  const h = buildHistory('pull_up', rows, '2026-08-22');
  assert.equal(h.last?.top_set, null);
  assert.equal(h.last?.volume_lb, 0);
  assert.equal(h.last?.all_sets_completed, true);
});

test('no history returns an explicit empty entry, not a throw', () => {
  const h = buildHistory('back_squat', [], '2026-08-22');
  assert.equal(h.sessions_logged, 0);
  assert.equal(h.last, null);
  assert.deepEqual(h.previous, []);
});

// ---------- dates: pitfall #2 ----------

test('local_date is computed in the user timezone, not UTC', () => {
  // 01:30 UTC on the 23rd is still the 22nd in New York.
  const at = new Date('2026-08-23T01:30:00.000Z');
  assert.equal(localDate(at, 'America/New_York'), '2026-08-22');
  assert.equal(localDate(at, 'UTC'), '2026-08-23');
  assert.equal(localDate(at, 'Asia/Tokyo'), '2026-08-23');
});

test('local_date survives a DST boundary', () => {
  // US DST ends 2026-11-01. 05:30 UTC is 01:30 EDT on the 1st.
  assert.equal(localDate(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York'), '2026-11-01');
  // 03:30 UTC on 2026-03-08 is 22:30 EST on the 7th, the day DST begins.
  assert.equal(localDate(new Date('2026-03-08T03:30:00.000Z'), 'America/New_York'), '2026-03-07');
});

test('shiftDate crosses month, year and DST boundaries', () => {
  assert.equal(shiftDate('2026-08-22', -6), '2026-08-16');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  // Across the DST change — the noon anchor keeps this from slipping a day.
  assert.equal(shiftDate('2026-11-02', -1), '2026-11-01');
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29'); // leap year
});

test('dateRange is inclusive and refuses to run away on an inverted range', () => {
  assert.deepEqual(dateRange('2026-08-20', '2026-08-22'), ['2026-08-20', '2026-08-21', '2026-08-22']);
  assert.equal(dateRange('2026-08-16', '2026-08-22').length, 7);
  assert.deepEqual(dateRange('2026-08-22', '2026-08-20'), []);
});

test('daysBetween counts whole calendar days', () => {
  assert.equal(daysBetween('2026-08-20', '2026-08-22'), 2);
  assert.equal(daysBetween('2026-08-22', '2026-08-22'), 0);
  assert.equal(daysBetween('2026-11-01', '2026-11-03'), 2); // spans DST end
});

test('isValidDate rejects malformed and impossible dates', () => {
  assert.equal(isValidDate('2026-08-22'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('8/22/2026'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(20260822), false);
  assert.equal(isValidDate(undefined), false);
});
