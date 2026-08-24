import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeTarget,
  patternCoverage,
  reconcile,
  normalizeTargetName,
} from '../src/domain/prescription.ts';
import type { PrescribedTarget, LoggedSet } from '../src/domain/prescription.ts';

const t = (o: Partial<PrescribedTarget>): PrescribedTarget => ({
  ordinal: o.ordinal ?? 1,
  exercise: o.exercise ?? 'back_squat',
  exercise_raw: o.exercise_raw ?? null,
  block: o.block ?? null,
  sets: o.sets ?? null,
  rep_low: o.rep_low ?? null,
  rep_high: o.rep_high ?? null,
  target_weight_lb: o.target_weight_lb ?? null,
  notes: o.notes ?? null,
});

const done = (exercise: string, reps: number, weight: number | null, completed = true): LoggedSet =>
  ({ exercise, reps, weight_lb: weight, completed });

test('a target reads the way a person writes it', () => {
  assert.equal(
    describeTarget(t({ exercise_raw: 'Back squat', sets: 4, rep_low: 6, rep_high: 6, target_weight_lb: 185 })),
    'Back squat 4×6 @ 185',
  );
});

test('a rep RANGE keeps both ends', () => {
  assert.equal(
    describeTarget(t({ exercise_raw: 'Bench press', sets: 3, rep_low: 8, rep_high: 10, target_weight_lb: 145 })),
    'Bench press 3×8-10 @ 145',
  );
});

test('a bodyweight movement carries no load', () => {
  assert.equal(
    describeTarget(t({ exercise_raw: 'Pallof press', sets: 3, rep_low: 10, rep_high: 10 })),
    'Pallof press 3×10',
  );
});

test('the normalized slug is the fallback name', () => {
  assert.equal(describeTarget(t({ exercise: 'farmers_carry', sets: 3 })), 'farmers_carry 3 sets');
});

test('pattern coverage finds the gap the transcript called out', () => {
  // "you have no hip hinge in your program at all" — derivable, and this is it.
  const squatDay = [t({ exercise: 'back_squat' }), t({ exercise: 'bench_press' })];
  const patterns = patternCoverage(squatDay);
  assert.ok(!patterns.includes('hinge'), `expected no hinge, got ${patterns.join(', ')}`);

  const withHinge = [...squatDay, t({ exercise: normalizeTargetName('romanian deadlift') })];
  assert.ok(patternCoverage(withHinge).includes('hinge'));
});

test('reconcile: everything hit', () => {
  const targets = [
    t({ exercise: 'back_squat', sets: 3, rep_low: 6, target_weight_lb: 185 }),
    t({ exercise: 'bench_press', ordinal: 2, sets: 3, rep_low: 8, target_weight_lb: 145 }),
  ];
  const logged = [
    done('back_squat', 6, 185), done('back_squat', 6, 185), done('back_squat', 6, 185),
    done('bench_press', 8, 145), done('bench_press', 8, 145), done('bench_press', 8, 145),
  ];
  const r = reconcile(targets, logged);
  assert.equal(r.adherence_pct, 100);
  assert.deepEqual(r.missed, []);
  assert.deepEqual(r.unplanned, []);
  assert.ok(r.compared.every((c) => c.met === true));
});

test('an exercise skipped entirely is missed, not met', () => {
  const targets = [
    t({ exercise: 'back_squat', sets: 3, target_weight_lb: 185 }),
    t({ exercise: 'farmers_carry', ordinal: 2, sets: 3, target_weight_lb: 70 }),
  ];
  const r = reconcile(targets, [done('back_squat', 6, 185)]);
  assert.deepEqual(r.missed, ['farmers_carry']);
  assert.equal(r.adherence_pct, 50);
  assert.equal(r.compared[1]!.met, false);
});

test('a substitution shows up as unplanned rather than vanishing', () => {
  const targets = [t({ exercise: 'back_squat', sets: 3, target_weight_lb: 185 })];
  const r = reconcile(targets, [done('back_squat', 6, 185), done('leg_press', 12, 300)]);
  assert.deepEqual(r.unplanned, ['leg_press']);
  assert.equal(r.adherence_pct, 100, 'the prescribed work was still done');
});

test('falling short of the target load is not met', () => {
  const targets = [t({ exercise: 'back_squat', sets: 3, target_weight_lb: 185 })];
  const r = reconcile(targets, [done('back_squat', 6, 175), done('back_squat', 6, 175), done('back_squat', 5, 175)]);
  assert.equal(r.compared[0]!.met, false);
  assert.equal(r.compared[0]!.actual!.top_weight_lb, 175);
  assert.equal(r.adherence_pct, 100, 'it was trained — met is the separate question');
});

test('too few sets at the right load is not met either', () => {
  const targets = [t({ exercise: 'back_squat', sets: 4, target_weight_lb: 185 })];
  const r = reconcile(targets, [done('back_squat', 6, 185), done('back_squat', 6, 185)]);
  assert.equal(r.compared[0]!.met, false);
  assert.equal(r.compared[0]!.actual!.sets, 2);
});

test('a MISSED set does not count toward the comparison', () => {
  const targets = [t({ exercise: 'back_squat', sets: 3, target_weight_lb: 185 })];
  const r = reconcile(targets, [
    done('back_squat', 6, 185), done('back_squat', 6, 185), done('back_squat', 2, 185, false),
  ]);
  assert.equal(r.compared[0]!.actual!.sets, 2, 'the failed attempt is excluded');
  assert.equal(r.compared[0]!.met, false);
});

test('a bodyweight target reports met as null, not false', () => {
  // There is no load to judge against, and reporting false would read as a
  // failure the user did not have.
  const targets = [t({ exercise: 'pallof_press', sets: 3, rep_low: 10 })];
  const r = reconcile(targets, [done('pallof_press', 10, null), done('pallof_press', 10, null), done('pallof_press', 10, null)]);
  assert.equal(r.compared[0]!.met, null);
  assert.equal(r.adherence_pct, 100);
});

test('exceeding the target counts as met', () => {
  const targets = [t({ exercise: 'back_squat', sets: 3, target_weight_lb: 185 })];
  const r = reconcile(targets, [done('back_squat', 6, 195), done('back_squat', 6, 195), done('back_squat', 6, 195)]);
  assert.equal(r.compared[0]!.met, true);
});

test('nothing logged at all is 0% and every exercise missed', () => {
  const targets = [t({ exercise: 'back_squat' }), t({ exercise: 'bench_press', ordinal: 2 })];
  const r = reconcile(targets, []);
  assert.equal(r.adherence_pct, 0);
  assert.equal(r.missed.length, 2);
});

test('aliases reconcile, because both sides are normalized', () => {
  // "RDL" prescribed, "romanian deadlift" logged. Without normalization on the
  // write path this silently reports 0% adherence.
  const key = normalizeTargetName('RDL');
  const r = reconcile([t({ exercise: key, sets: 3, target_weight_lb: 115 })], [
    done(normalizeTargetName('romanian deadlift'), 8, 115),
    done(normalizeTargetName('Romanian Deadlifts'), 8, 115),
    done(normalizeTargetName('rdl'), 8, 115),
  ]);
  assert.equal(r.adherence_pct, 100, `"${key}" did not reconcile`);
  assert.deepEqual(r.unplanned, []);
});
