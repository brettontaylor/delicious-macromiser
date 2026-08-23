/**
 * When is the user's next meal, and what kind?
 *
 * Pure shaping over their own history — data, not advice. "You usually eat
 * lunch around 12:40 and have 1,850 kcal left" is a fact the page can render
 * with no model involved. "Have the chicken" is a judgement and lives in the
 * Skill (PRODUCT.md §2).
 *
 * Two rules keep this honest:
 *
 *  1. **Only same-day logs count.** A backfilled or imported meal carries the
 *     timestamp of when it was WRITTEN, not when it was eaten, so including it
 *     would learn the time of the import rather than the time of the meal. A
 *     row only teaches a time when the day it was logged on matches the day it
 *     belongs to.
 *  2. **Not enough history returns null.** Three observations of a meal type is
 *     the floor. Below that this would be pattern-matching on noise, and a
 *     confident wrong answer is worse than an empty slot.
 */

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MIN_OBSERVATIONS = 3;

export interface TimedMeal {
  local_date: string;
  /** ISO8601 UTC, from `meals.logged_at`. */
  logged_at: string;
  meal_type: string | null;
}

export interface SlotPrediction {
  meal_type: MealSlot;
  /** HH:MM in the user's timezone. */
  typical_time: string;
  /** How many same-day logs the estimate rests on. */
  observations: number;
  /** Half the interquartile spread, in minutes — how tight the habit is. */
  spread_min: number;
  /** True when the prediction is for tomorrow rather than later today. */
  tomorrow: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function minutesToClock(m: number): string {
  const wrapped = ((m % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

export function clockToMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Half the interquartile range — a robust spread that one 3am snack cannot blow up. */
function halfIqr(xs: number[]): number {
  if (xs.length < 4) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return Math.round((q(0.75) - q(0.25)) / 2);
}

/**
 * Local time-of-day, in minutes past midnight, for an instant in a timezone.
 * Exported so callers can build `TimedMeal`s without duplicating the Intl call.
 */
export function localMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return clockToMinutes(parts);
}

/** Local calendar date for an instant, as YYYY-MM-DD. */
function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export interface NextMeal {
  next: SlotPrediction | null;
  /** Every slot with enough history, in day order. Useful for a fuller view. */
  pattern: SlotPrediction[];
  /** Same-day logs considered. Low numbers explain a null `next`. */
  usable_logs: number;
  /** Set when `next` is null, so the caller can say why rather than go blank. */
  reason: string | null;
}

export function nextMeal(meals: TimedMeal[], now: Date, tz: string): NextMeal {
  // Rule 1: a meal only teaches a time if it was logged on the day it belongs to.
  const sameDay = meals.filter(
    (m) => m.meal_type !== null && localDay(new Date(m.logged_at), tz) === m.local_date,
  );

  const bySlot = new Map<MealSlot, number[]>();
  for (const m of sameDay) {
    const slot = m.meal_type as MealSlot;
    if (!SLOT_ORDER.includes(slot)) continue;
    const mins = localMinutes(new Date(m.logged_at), tz);
    if (!Number.isFinite(mins)) continue;
    const list = bySlot.get(slot) ?? [];
    list.push(mins);
    bySlot.set(slot, list);
  }

  const pattern: SlotPrediction[] = [];
  for (const slot of SLOT_ORDER) {
    const times = bySlot.get(slot);
    if (!times || times.length < MIN_OBSERVATIONS) continue;
    pattern.push({
      meal_type: slot,
      typical_time: minutesToClock(median(times)),
      observations: times.length,
      spread_min: halfIqr(times),
      tomorrow: false,
    });
  }
  pattern.sort((a, b) => clockToMinutes(a.typical_time) - clockToMinutes(b.typical_time));

  if (pattern.length === 0) {
    return {
      next: null,
      pattern: [],
      usable_logs: sameDay.length,
      reason:
        sameDay.length === 0
          ? 'No meals logged on the day they were eaten yet — imported history carries the time it was written, not the time it was eaten.'
          : `Not enough history: no meal type has ${MIN_OBSERVATIONS} same-day logs yet.`,
    };
  }

  const nowMin = localMinutes(now, tz);
  const later = pattern.find((p) => clockToMinutes(p.typical_time) > nowMin);
  if (later) return { next: later, pattern, usable_logs: sameDay.length, reason: null };

  // Past the last slot of the day — the next one is tomorrow's first.
  return {
    next: { ...pattern[0]!, tomorrow: true },
    pattern,
    usable_logs: sameDay.length,
    reason: null,
  };
}
