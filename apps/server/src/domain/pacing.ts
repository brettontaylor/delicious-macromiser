/**
 * Intra-day pace — "100 g of protein by 2pm, which is your best yet."
 *
 * Straight out of a real coaching session, where the useful sentence was not
 * the total but the comparison: *"Compare to Thursday, when you were at 35g at
 * this point."* Every number that makes that sentence possible is already in
 * `meals` — `logged_at` has been there since `0001_init.sql`. Nothing exposed
 * it, so the model could only ever see the day as a finished total.
 *
 * Pure, D1-free, and facts only. Whether being behind pace matters at 2pm on a
 * rest day is the Skill's call; this module reports where the line sits.
 */

import { localMinutes } from './mealtimes.ts';

export interface PacedMeal {
  local_date: string;
  /** ISO8601 UTC, as stored. */
  logged_at: string;
  protein_g: number;
  kcal: number;
}

export interface DayPace {
  local_date: string;
  protein_g: number;
  kcal: number;
}

export interface Pace {
  /** Minutes past local midnight the comparison is drawn at. */
  as_of_minutes: number;
  protein_g: number;
  kcal: number;
  /** Median of the same clock-time totals on comparable past days. */
  typical_protein_g: number | null;
  typical_kcal: number | null;
  /** How many past days had usable, same-day-logged data by this hour. */
  days_compared: number;
  /** 1 = best of every day compared. Null when there is nothing to compare. */
  rank: number | null;
  /** True when today beats every comparable day at this hour. */
  best_yet: boolean;
  /** Set when a comparison could not be made, so the caller can say why. */
  reason: string | null;
}

/** At least this many past days before a "typical" means anything. */
const MIN_DAYS = 3;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Only meals logged on the day they belong to can teach anything about timing.
 *
 * A backfilled row carries the time it was WRITTEN, not the time it was eaten
 * (GOTCHAS, "Schema and data") — so an import of three weeks of history at
 * 9pm on a Sunday would otherwise look like three weeks of 9pm dinners. Same
 * rule `mealtimes.ts` applies, for the same reason.
 */
function sameDay(meals: PacedMeal[], tz: string): PacedMeal[] {
  return meals.filter((m) => {
    const at = new Date(m.logged_at);
    if (Number.isNaN(at.getTime())) return false;
    return localDayOf(at, tz) === m.local_date;
  });
}

function localDayOf(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Totals reached by `cutoffMinutes` past midnight, per day, across the history
 * given. Days with no qualifying meal are absent rather than zero — a day that
 * was never logged is not a day of eating nothing, and averaging zeros in is
 * how you tell someone they are doing great when they simply stopped tracking.
 */
export function totalsByCutoff(
  meals: PacedMeal[],
  cutoffMinutes: number,
  tz: string,
  excludeDate: string,
): DayPace[] {
  const byDate = new Map<string, DayPace>();
  const loggedDays = new Set<string>();

  for (const m of sameDay(meals, tz)) {
    if (m.local_date === excludeDate) continue;
    loggedDays.add(m.local_date);
    if (localMinutes(new Date(m.logged_at), tz) > cutoffMinutes) continue;
    const acc = byDate.get(m.local_date) ?? { local_date: m.local_date, protein_g: 0, kcal: 0 };
    acc.protein_g += m.protein_g;
    acc.kcal += m.kcal;
    byDate.set(m.local_date, acc);
  }

  // A day that WAS logged but had nothing before the cutoff is a real zero —
  // they genuinely had not eaten yet. Keep it; dropping it would flatter today.
  for (const d of loggedDays) {
    if (!byDate.has(d)) byDate.set(d, { local_date: d, protein_g: 0, kcal: 0 });
  }

  return [...byDate.values()].sort((a, b) => (a.local_date < b.local_date ? 1 : -1));
}

export function pace(
  todayMeals: PacedMeal[],
  historyMeals: PacedMeal[],
  now: Date,
  tz: string,
  today: string,
): Pace {
  const nowMin = localMinutes(now, tz);

  const soFar = todayMeals.reduce(
    (a, m) => ({ protein_g: a.protein_g + m.protein_g, kcal: a.kcal + m.kcal }),
    { protein_g: 0, kcal: 0 },
  );
  const protein = Math.round(soFar.protein_g);
  const kcal = Math.round(soFar.kcal);

  const past = totalsByCutoff(historyMeals, nowMin, tz, today);

  if (past.length < MIN_DAYS) {
    return {
      as_of_minutes: nowMin,
      protein_g: protein,
      kcal,
      typical_protein_g: null,
      typical_kcal: null,
      days_compared: past.length,
      rank: null,
      best_yet: false,
      reason:
        past.length === 0
          ? 'No days logged as they happened yet — imported history carries the time it was written, so it cannot teach pace.'
          : `Only ${past.length} comparable day${past.length === 1 ? '' : 's'}; ${MIN_DAYS} are needed before "typical" means anything.`,
    };
  }

  const proteins = past.map((d) => d.protein_g);
  const better = proteins.filter((p) => p > soFar.protein_g).length;

  return {
    as_of_minutes: nowMin,
    protein_g: protein,
    kcal,
    typical_protein_g: Math.round(median(proteins)),
    typical_kcal: Math.round(median(past.map((d) => d.kcal))),
    days_compared: past.length,
    rank: better + 1,
    // Strictly best: ties are not a personal best, and calling one that would
    // make the phrase worthless the third time it appears.
    best_yet: better === 0 && proteins.every((p) => p < soFar.protein_g),
    reason: null,
  };
}
