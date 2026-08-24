import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pace, totalsByCutoff } from '../src/domain/pacing.ts';
import type { PacedMeal } from '../src/domain/pacing.ts';

const TZ = 'America/New_York';

/** A meal logged at a local clock time on its own day. EDT is UTC-4. */
const at = (date: string, hhmm: string, protein: number, kcal = protein * 8): PacedMeal => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00-04:00`);
  utc.setUTCHours(utc.getUTCHours() + h!, utc.getUTCMinutes() + m!);
  return { local_date: date, logged_at: utc.toISOString(), protein_g: protein, kcal };
};

/** A backfilled row: belongs to `date` but was written later, on `writtenOn`. */
const backfilled = (date: string, writtenOn: string, protein: number): PacedMeal => ({
  local_date: date,
  logged_at: new Date(`${writtenOn}T21:00:00-04:00`).toISOString(),
  protein_g: protein,
  kcal: protein * 8,
});

const NOW = new Date('2026-08-20T18:00:00Z'); // 14:00 in New York
const TODAY = '2026-08-20';

test('below three comparable days it declines to guess, and says why', () => {
  const out = pace([at(TODAY, '09:00', 40)], [at('2026-08-19', '09:00', 30)], NOW, TZ, TODAY);
  assert.equal(out.typical_protein_g, null);
  assert.equal(out.days_compared, 1);
  assert.match(out.reason!, /Only 1 comparable day/);
  assert.equal(out.protein_g, 40, 'today still totals correctly');
});

test('with no same-day history at all it names the import problem', () => {
  const out = pace([], [backfilled('2026-08-19', '2026-08-20', 90)], NOW, TZ, TODAY);
  assert.equal(out.days_compared, 0);
  assert.match(out.reason!, /imported history carries the time it was written/);
});

test('a backfilled row never teaches pace', () => {
  // The GOTCHAS rule: logged_at is when it was WRITTEN. Three weeks imported at
  // 9pm on a Sunday must not read as three weeks of 9pm eating.
  const history = [
    backfilled('2026-08-17', '2026-08-20', 150),
    backfilled('2026-08-18', '2026-08-20', 150),
    backfilled('2026-08-19', '2026-08-20', 150),
  ];
  const out = pace([at(TODAY, '09:00', 40)], history, NOW, TZ, TODAY);
  assert.equal(out.days_compared, 0, 'none of them count');
});

test('the transcript case: best pace yet', () => {
  const history = [
    at('2026-08-17', '08:00', 20),
    at('2026-08-18', '08:00', 35),
    at('2026-08-19', '08:00', 30),
    at('2026-08-19', '12:30', 25),
  ];
  const today = [at(TODAY, '07:30', 18), at(TODAY, '09:00', 20), at(TODAY, '13:00', 62)];
  const out = pace(today, history, NOW, TZ, TODAY);
  assert.equal(out.protein_g, 100);
  assert.equal(out.days_compared, 3);
  assert.equal(out.best_yet, true);
  assert.equal(out.rank, 1);
  assert.equal(out.typical_protein_g, 35, 'median of 20, 35, 55');
});

test('a meal logged after the cutoff does not count toward a past day', () => {
  // 14:00 is the comparison point; the 19:00 dinner is in the future at that
  // hour and including it would make every past day look better than today.
  const history = [
    at('2026-08-17', '09:00', 30),
    at('2026-08-17', '19:00', 90),
    at('2026-08-18', '09:00', 30),
    at('2026-08-19', '09:00', 30),
  ];
  const out = pace([at(TODAY, '09:00', 40)], history, NOW, TZ, TODAY);
  assert.equal(out.typical_protein_g, 30);
  assert.equal(out.best_yet, true, '40 beats all three 30s');
});

test('a day that was logged but empty by the cutoff counts as a real zero', () => {
  // Dropping it would flatter today by comparing only against good days.
  const history = [
    at('2026-08-17', '20:00', 120),
    at('2026-08-18', '09:00', 30),
    at('2026-08-19', '09:00', 40),
  ];
  const totals = totalsByCutoff(history, 14 * 60, TZ, TODAY);
  assert.equal(totals.length, 3);
  assert.equal(totals.find((d) => d.local_date === '2026-08-17')!.protein_g, 0);
});

test('ties are not a personal best', () => {
  const history = [
    at('2026-08-17', '09:00', 40),
    at('2026-08-18', '09:00', 30),
    at('2026-08-19', '09:00', 20),
  ];
  const out = pace([at(TODAY, '09:00', 40)], history, NOW, TZ, TODAY);
  assert.equal(out.best_yet, false, 'matching the best is not beating it');
  assert.equal(out.rank, 1, 'but nothing is strictly ahead of it either');
});

test('rank counts the days that are genuinely ahead', () => {
  const history = [
    at('2026-08-16', '09:00', 90),
    at('2026-08-17', '09:00', 80),
    at('2026-08-18', '09:00', 20),
    at('2026-08-19', '09:00', 10),
  ];
  const out = pace([at(TODAY, '09:00', 50)], history, NOW, TZ, TODAY);
  assert.equal(out.rank, 3);
  assert.equal(out.best_yet, false);
});

test('today is excluded from its own comparison', () => {
  const history = [
    at(TODAY, '09:00', 999),
    at('2026-08-17', '09:00', 30),
    at('2026-08-18', '09:00', 30),
    at('2026-08-19', '09:00', 30),
  ];
  const out = pace([at(TODAY, '09:00', 40)], history, NOW, TZ, TODAY);
  assert.equal(out.days_compared, 3);
  assert.equal(out.best_yet, true);
});

test('as_of_minutes is the local clock, not UTC', () => {
  const out = pace([], [], NOW, TZ, TODAY);
  assert.equal(out.as_of_minutes, 14 * 60, '18:00 UTC is 14:00 in New York');
});

test('an unparseable logged_at is skipped rather than throwing', () => {
  const junk: PacedMeal = {
    local_date: '2026-08-19',
    logged_at: 'not a timestamp',
    protein_g: 50,
    kcal: 400,
  };
  const out = pace([], [junk, at('2026-08-18', '09:00', 30)], NOW, TZ, TODAY);
  assert.equal(out.days_compared, 1);
});
