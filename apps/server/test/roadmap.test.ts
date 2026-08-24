import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROADMAP, byStatus, roadmapCounts, roadmapItem } from '../src/domain/roadmap.ts';

test('ids are unique — inline stubs address rows by id', () => {
  const ids = ROADMAP.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every id the app stubs actually resolves', () => {
  // The ids hard-coded in app/page.ts and app/recipes.ts. A stub whose id has
  // been renamed renders nothing at all, which is a silent failure — so the
  // list is asserted here rather than discovered on the phone.
  for (const id of ['session', 'weekly-budget', 'adherence', 'shopping-list']) {
    assert.notEqual(roadmapItem(id), null, `stub id "${id}" has no roadmap row`);
  }
});

test('an unknown id resolves to null rather than throwing', () => {
  assert.equal(roadmapItem('not-a-thing'), null);
});

test('planned items come back in rank order', () => {
  const ranks = byStatus('next').map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => (a ?? 99) - (b ?? 99)));
  assert.equal(byStatus('next')[0]?.rank, 1, 'the head of the list is rank 1');
});

test('a shipped item is no longer in the planned list', () => {
  // Guards the move: an item left in both places renders as "planned" on
  // /roadmap while its inline stub is already gone.
  for (const id of ['events', 'pacing']) {
    assert.equal(byStatus('next').some((r) => r.id === id), false, `${id} still planned`);
    assert.equal(byStatus('shipped').some((r) => r.id === id), true, `${id} not shipped`);
  }
});

test('every planned item has a rank, and nothing else does', () => {
  for (const item of ROADMAP) {
    if (item.status === 'next') assert.ok(item.rank, `${item.id} is planned with no rank`);
    else assert.equal(item.rank, undefined, `${item.id} is ${item.status} but carries a rank`);
  }
});

test('ranks are distinct — two items cannot both be next', () => {
  const ranks = byStatus('next').map((r) => r.rank);
  assert.equal(new Set(ranks).size, ranks.length);
});

test('shipped items carry a date and gated items carry a reason', () => {
  for (const item of byStatus('shipped')) {
    assert.match(item.shipped_on ?? '', /^\d{4}-\d{2}-\d{2}$/, `${item.id} has no shipped date`);
  }
  for (const item of byStatus('gated')) {
    assert.ok(item.blocked_by, `${item.id} is gated with no stated blocker`);
  }
});

test('counts match the arrays they summarise', () => {
  const c = roadmapCounts();
  assert.equal(c.shipped + c.next + c.gated, ROADMAP.length);
});
