import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeOn,
  caveatActive,
  cloudedReadings,
  inWindow,
  isEventAffects,
  isEventKind,
  overlaps,
  viewEvent,
} from '../src/domain/events.ts';
import type { EventRow } from '../src/domain/events.ts';

const ev = (o: Partial<EventRow>): EventRow => ({
  id: o.id ?? 'e1',
  kind: o.kind ?? 'other',
  label: o.label ?? 'something',
  starts_on: o.starts_on ?? '2026-08-01',
  ends_on: o.ends_on ?? null,
  caveat_until: o.caveat_until ?? null,
  affects: o.affects ?? 'none',
  notes: o.notes ?? null,
});

// The transcript's actual case, and the reason this table exists.
const CREATINE = ev({
  id: 'creatine',
  kind: 'supplement',
  label: 'Started creatine, 5 g daily',
  starts_on: '2026-08-15',
  ends_on: null,
  caveat_until: '2026-09-05',
  affects: 'weight',
});

const TRIP = ev({
  id: 'trip',
  kind: 'travel',
  label: 'Five days in Italy',
  starts_on: '2026-08-10',
  ends_on: '2026-08-14',
  caveat_until: '2026-08-14',
  affects: 'nutrition',
});

test('an ongoing event has no end and overlaps every later day', () => {
  assert.equal(overlaps(CREATINE, '2026-08-15'), true, 'the start day counts');
  assert.equal(overlaps(CREATINE, '2027-01-01'), true, 'still ongoing months later');
  assert.equal(overlaps(CREATINE, '2026-08-14'), false, 'not before it started');
});

test('a bounded event stops overlapping after its end', () => {
  assert.equal(overlaps(TRIP, '2026-08-14'), true, 'the last day is inclusive');
  assert.equal(overlaps(TRIP, '2026-08-15'), false);
});

test('the caveat window is NOT the same as the event ending', () => {
  // The distinction the whole schema turns on: creatine is taken forever, but
  // only clouds the scale for three weeks. Collapsing these loses one of them.
  assert.equal(caveatActive(CREATINE, '2026-08-28'), true, 'still settling in week two');
  assert.equal(caveatActive(CREATINE, '2026-09-06'), false, 'water weight is done');
  assert.equal(overlaps(CREATINE, '2026-09-06'), true, 'but the supplement is not');
});

test('affects "none" never opens a caveat, even with a date set', () => {
  const marked = ev({ affects: 'none', caveat_until: '2026-12-31', starts_on: '2026-08-01' });
  assert.equal(caveatActive(marked, '2026-08-05'), false);
});

test('activeOn returns the ongoing and the still-clouding, newest first', () => {
  const out = activeOn([TRIP, CREATINE], '2026-08-20');
  assert.deepEqual(out.map((e) => e.id), ['creatine'], 'the trip is over and its caveat closed');

  const during = activeOn([TRIP, CREATINE], '2026-08-12');
  assert.deepEqual(during.map((e) => e.id), ['trip'], 'creatine has not started yet');
});

test('an event whose caveat is open but which has ended still surfaces', () => {
  const hangover = ev({
    id: 'h',
    starts_on: '2026-08-01',
    ends_on: '2026-08-02',
    caveat_until: '2026-08-20',
    affects: 'weight',
  });
  const out = activeOn([hangover], '2026-08-10');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ongoing, false, 'the thing is over');
  assert.equal(out[0]!.caveat_active, true, 'the distortion is not');
});

test('caveat_days_left counts down and is null once closed', () => {
  assert.equal(viewEvent(CREATINE, '2026-09-01').caveat_days_left, 4);
  assert.equal(viewEvent(CREATINE, '2026-09-05').caveat_days_left, 0, 'the last day is still in');
  assert.equal(viewEvent(CREATINE, '2026-09-06').caveat_days_left, null);
});

test('days_since_start is measured from the start, not the caveat', () => {
  assert.equal(viewEvent(CREATINE, '2026-08-24').days_since_start, 9);
});

test('cloudedReadings de-duplicates and expands "all"', () => {
  const everything = ev({
    id: 'flu',
    affects: 'all',
    starts_on: '2026-08-18',
    caveat_until: '2026-08-25',
  });
  const out = cloudedReadings([CREATINE, everything], '2026-08-20').sort();
  assert.deepEqual(out, ['nutrition', 'training', 'weight']);
});

test('cloudedReadings is empty when nothing is currently clouding', () => {
  assert.deepEqual(cloudedReadings([CREATINE, TRIP], '2026-09-30'), []);
});

test('inWindow keeps an ongoing event that started before the window', () => {
  // The bug this guards: an `ends_on BETWEEN start AND end` filter drops every
  // open-ended supplement, which is exactly the row the chart needs to draw.
  const got = inWindow([CREATINE], '2026-09-01', '2026-09-30');
  assert.equal(got.length, 1);
});

test('inWindow excludes an event entirely in the past', () => {
  assert.deepEqual(inWindow([TRIP], '2026-09-01', '2026-09-30'), []);
});

test('inWindow excludes an event that has not started yet', () => {
  assert.deepEqual(inWindow([CREATINE], '2026-07-01', '2026-07-31'), []);
});

test('kind and affects guards reject junk', () => {
  assert.equal(isEventKind('supplement'), true);
  assert.equal(isEventKind('Supplement'), false, 'case matters — the column is a controlled value');
  assert.equal(isEventKind(''), false);
  assert.equal(isEventKind(null), false);
  assert.equal(isEventAffects('weight'), true);
  assert.equal(isEventAffects('scale'), false);
});
