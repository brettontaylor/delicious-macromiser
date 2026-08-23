import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planView, weekdayIndex, whenPhrase } from '../src/domain/plan.ts';
import type { PlanDayInput } from '../src/domain/plan.ts';

const d = (weekday: number, kind: string, label: string | null = null, notes: string | null = null): PlanDayInput =>
  ({ weekday, kind, label, notes });

// Sun rest · Mon upper · Tue lower · Wed rest · Thu upper · Fri lower · Sat active
const SPLIT: PlanDayInput[] = [
  d(0, 'rest', null, 'no alcohol'),
  d(1, 'lift', 'Upper body'),
  d(2, 'lift', 'Lower body'),
  d(3, 'rest', null, 'walk 10,000 steps, no phone after 8'),
  d(4, 'lift', 'Upper body'),
  d(5, 'lift', 'Lower body'),
  d(6, 'active', 'Long walk'),
];

test('an empty plan says so rather than inventing a rest day', () => {
  const v = planView([], 2);
  assert.equal(v.empty, true);
  assert.equal(v.today, null);
  assert.equal(v.next_lift, null);
});

test('today reads back with its notes', () => {
  const v = planView(SPLIT, 3); // Wednesday
  assert.equal(v.today?.kind, 'rest');
  assert.equal(v.today?.weekday_name, 'Wednesday');
  assert.equal(v.today?.notes, 'walk 10,000 steps, no phone after 8');
});

test('the next lift day is found from a rest day', () => {
  const v = planView(SPLIT, 3); // Wednesday, rest
  assert.equal(v.next_lift?.weekday_name, 'Thursday');
  assert.equal(v.next_lift?.label, 'Upper body');
  assert.equal(v.next_lift?.days_away, 1);
});

test('a lift day today reports itself, not next week', () => {
  const v = planView(SPLIT, 2); // Tuesday, lower
  assert.equal(v.next_lift?.days_away, 0);
  assert.equal(v.next_lift?.label, 'Lower body');
});

test('the search wraps around the end of the week', () => {
  // Only Monday lifts. From Saturday the next one is two days out.
  const sparse = [d(1, 'lift', 'Full body'), d(6, 'rest')];
  const v = planView(sparse, 6); // Saturday
  assert.equal(v.next_lift?.weekday_name, 'Monday');
  assert.equal(v.next_lift?.days_away, 2);
});

test('a plan with no lift days at all returns no next lift', () => {
  const v = planView([d(0, 'rest'), d(1, 'active', 'Walk')], 0);
  assert.equal(v.empty, false);
  assert.equal(v.next_lift, null);
  assert.equal(v.today?.kind, 'rest');
});

test('a day missing from the plan leaves today null but still finds the next lift', () => {
  const partial = [d(2, 'lift', 'Lower body')];
  const v = planView(partial, 0); // Sunday has no entry
  assert.equal(v.today, null);
  assert.equal(v.next_lift?.days_away, 2);
});

test('an unrecognised kind is not passed through as today', () => {
  const v = planView([d(1, 'nonsense')], 1);
  assert.equal(v.today, null, 'only lift/active/rest should reach the caller');
});

test('weekday names map to indices, case-insensitively', () => {
  assert.equal(weekdayIndex('Sunday'), 0);
  assert.equal(weekdayIndex('tuesday'), 2);
  assert.equal(weekdayIndex('  Saturday '), 6);
  assert.equal(weekdayIndex('Caturday'), -1);
});

test('when-phrase reads like a person', () => {
  assert.equal(whenPhrase(0, 'Tuesday'), 'today');
  assert.equal(whenPhrase(1, 'Wednesday'), 'tomorrow');
  assert.equal(whenPhrase(4, 'Friday'), 'Friday');
});
