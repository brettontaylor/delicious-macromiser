/**
 * Timezone handling. ARCHITECTURE.md pitfall #2: compute `local_date` on write,
 * in the user's tz, always. Doing it at query time across DST boundaries is a
 * recurring bug factory.
 */

/** YYYY-MM-DD for `at` as observed in `tz`. */
export function localDate(at: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the storage format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Day-of-week name in `tz` — the Skill uses this for recovery spacing. */
export function localWeekday(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(at);
}

/** Local wall-clock HH:MM in `tz` — lets the Skill judge "behind pace on protein". */
export function localTime(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** `n` calendar days before `date` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // Noon UTC anchor avoids the shift itself crossing a DST or date boundary.
  const anchor = Date.UTC(y!, m! - 1, d!, 12);
  const moved = new Date(anchor + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against an inverted range producing an unbounded loop.
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}

/** Whole days between two YYYY-MM-DD dates (later - earlier). */
export function daysBetween(earlier: string, later: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((p(later) - p(earlier)) / 86_400_000);
}

/** Validate a caller-supplied date. Never trust model-supplied strings. */
export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m! < 1 || m! > 12 || d! < 1 || d! > 31) return false;
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  return probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d!;
}
