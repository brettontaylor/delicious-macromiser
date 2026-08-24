/**
 * Events — the arithmetic of "which annotations apply to this day".
 *
 * Pure and D1-free, like every other module here. The judgement stays in the
 * Skill: this module says *creatine started 9 days ago and its caveat window is
 * still open*, never *ignore the scale*. The first is a fact about the data;
 * the second is coaching, and coaching changes weekly.
 */

import { daysBetween } from '../util/date.ts';

export type EventKind =
  | 'supplement'
  | 'travel'
  | 'injury'
  | 'illness'
  | 'deload'
  | 'life'
  | 'other';

/** Which readings an event makes harder to trust. */
export type EventAffects = 'weight' | 'training' | 'nutrition' | 'all' | 'none';

export const EVENT_KINDS: EventKind[] = [
  'supplement',
  'travel',
  'injury',
  'illness',
  'deload',
  'life',
  'other',
];

export const EVENT_AFFECTS: EventAffects[] = ['weight', 'training', 'nutrition', 'all', 'none'];

export function isEventKind(v: unknown): v is EventKind {
  return typeof v === 'string' && (EVENT_KINDS as string[]).includes(v);
}

export function isEventAffects(v: unknown): v is EventAffects {
  return typeof v === 'string' && (EVENT_AFFECTS as string[]).includes(v);
}

export interface EventRow {
  id: string;
  kind: string;
  label: string;
  starts_on: string;
  ends_on: string | null;
  caveat_until: string | null;
  affects: string;
  notes: string | null;
}

export interface EventView extends EventRow {
  /** Still going on `asOf` — started, and not yet ended. */
  ongoing: boolean;
  /** Its distortion window covers `asOf`. Independent of `ongoing`: creatine
   *  stays ongoing long after its three weeks of water weight are done. */
  caveat_active: boolean;
  days_since_start: number;
  /** Days until the caveat lifts. Null when there is no window, or it has passed. */
  caveat_days_left: number | null;
}

/**
 * Does an event overlap a date? An event with no `ends_on` is ongoing and
 * overlaps everything from `starts_on` forward — the common case, and the one
 * an `ends_on IS NOT NULL` filter would silently drop.
 */
export function overlaps(e: EventRow, date: string): boolean {
  if (date < e.starts_on) return false;
  return e.ends_on === null || date <= e.ends_on;
}

/** Is the distortion window open on `date`? */
export function caveatActive(e: EventRow, date: string): boolean {
  if (e.affects === 'none' || e.caveat_until === null) return false;
  return date >= e.starts_on && date <= e.caveat_until;
}

export function viewEvent(e: EventRow, asOf: string): EventView {
  const active = caveatActive(e, asOf);
  return {
    ...e,
    ongoing: overlaps(e, asOf),
    caveat_active: active,
    days_since_start: daysBetween(e.starts_on, asOf),
    caveat_days_left: active && e.caveat_until ? daysBetween(asOf, e.caveat_until) : null,
  };
}

/**
 * The events worth telling the model about on a given day: anything currently
 * ongoing, plus anything whose caveat window is still open. Sorted newest
 * start first, because the recent one is nearly always the relevant one.
 */
export function activeOn(events: EventRow[], asOf: string): EventView[] {
  return events
    .map((e) => viewEvent(e, asOf))
    .filter((e) => e.ongoing || e.caveat_active)
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : a.starts_on > b.starts_on ? -1 : 0));
}

/**
 * Which of `affects` currently have an open caveat, as a de-duplicated list.
 * `all` expands, so a model checking for 'weight' does not miss a travel event
 * that clouded everything.
 */
export function cloudedReadings(events: EventRow[], asOf: string): EventAffects[] {
  const out = new Set<EventAffects>();
  for (const e of events) {
    if (!caveatActive(e, asOf)) continue;
    if (e.affects === 'all') {
      out.add('weight');
      out.add('training');
      out.add('nutrition');
    } else if (isEventAffects(e.affects) && e.affects !== 'none') {
      out.add(e.affects);
    }
  }
  return [...out];
}

/**
 * Events that intersect a window at all — used by the chart, which needs the
 * ones it can actually draw rather than only the ones active today.
 */
export function inWindow(events: EventRow[], start: string, end: string): EventRow[] {
  return events.filter((e) => e.starts_on <= end && (e.ends_on === null || e.ends_on >= start));
}
