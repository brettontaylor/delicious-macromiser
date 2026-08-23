/**
 * Today's intention, and when the next lift day falls.
 *
 * Everything else in this codebase records the past. This is the one piece that
 * looks forward — and it is still only data. "Tuesday is lower body" and "that
 * is two days away" are facts. Whether to push the session, deload, or skip it
 * is judgement and belongs in the Skill.
 *
 * A day with no plan returns null rather than a default. Inventing a rest day
 * for someone who never set one up would be indistinguishable, to them, from
 * the app telling them not to train.
 */

export type PlanKind = 'lift' | 'active' | 'rest';

export interface PlanDayInput {
  weekday: number;
  kind: string;
  label: string | null;
  notes: string | null;
}

export interface PlanToday {
  weekday: number;
  weekday_name: string;
  kind: PlanKind;
  label: string | null;
  /** Free text the user wrote for this kind of day: "walk 10k, no alcohol". */
  notes: string | null;
}

export interface NextLift {
  weekday: number;
  weekday_name: string;
  label: string | null;
  /** 0 means today. 1 means tomorrow. */
  days_away: number;
}

export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const KINDS: PlanKind[] = ['lift', 'active', 'rest'];

export function isPlanKind(v: unknown): v is PlanKind {
  return typeof v === 'string' && KINDS.includes(v as PlanKind);
}

export function weekdayIndex(name: string): number {
  return WEEKDAY_NAMES.findIndex((d) => d.toLowerCase() === name.trim().toLowerCase());
}

export interface PlanView {
  today: PlanToday | null;
  next_lift: NextLift | null;
  /** True when no plan has been set up at all, so callers can say so rather
   *  than showing an empty box. */
  empty: boolean;
}

export function planView(plan: PlanDayInput[], todayWeekday: number): PlanView {
  if (plan.length === 0) return { today: null, next_lift: null, empty: true };

  const byDay = new Map(plan.map((d) => [d.weekday, d]));

  const t = byDay.get(todayWeekday);
  const today: PlanToday | null =
    t && isPlanKind(t.kind)
      ? {
          weekday: todayWeekday,
          weekday_name: WEEKDAY_NAMES[todayWeekday]!,
          kind: t.kind,
          label: t.label,
          notes: t.notes,
        }
      : null;

  // Search forward from today. Starting at 0 means "today is a lift day" is
  // reported as days_away 0 rather than skipping to next week.
  let next: NextLift | null = null;
  for (let i = 0; i < 7; i++) {
    const wd = (todayWeekday + i) % 7;
    const d = byDay.get(wd);
    if (d?.kind === 'lift') {
      next = {
        weekday: wd,
        weekday_name: WEEKDAY_NAMES[wd]!,
        label: d.label,
        days_away: i,
      };
      break;
    }
  }

  return { today, next_lift: next, empty: false };
}

/** "today", "tomorrow", or the weekday name — how a person would say it. */
export function whenPhrase(daysAway: number, weekdayName: string): string {
  if (daysAway === 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  return weekdayName;
}
