import type { Ctx } from '../../db/queries.ts';
import { getTrainingPlan, upsertPlanDay } from '../../db/queries.ts';
import { planView, weekdayIndex, isPlanKind, WEEKDAY_NAMES } from '../../domain/plan.ts';
import { localWeekday } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError } from './args.ts';

function todayIndex(ctx: Ctx): number {
  return weekdayIndex(localWeekday(ctx.now, ctx.tz));
}

/**
 * Define the week. One row per weekday, upserted, so "move leg day to Thursday"
 * is one call and not a rewrite of the whole split.
 */
export async function setTrainingPlan(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const raw = args['days'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('"days" is required and must be a non-empty array.');
  }
  if (raw.length > 7) throw new ArgError('"days" cannot exceed 7 entries.');

  const written: string[] = [];
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`days[${i}] must be an object.`);
    }
    const d = entry as Record<string, unknown>;

    const wdRaw = d['weekday'];
    const wd = typeof wdRaw === 'string' ? weekdayIndex(wdRaw) : Number(wdRaw);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      throw new ArgError(
        `days[${i}].weekday must be a weekday name or 0-6 (0 = Sunday). Got ${JSON.stringify(wdRaw)}.`,
      );
    }

    const kind = d['kind'];
    if (!isPlanKind(kind)) {
      throw new ArgError(`days[${i}].kind must be one of: lift, active, rest.`);
    }
    const label = d['label'];
    const notes = d['notes'];
    if (label !== undefined && label !== null && typeof label !== 'string') {
      throw new ArgError(`days[${i}].label must be a string.`);
    }
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      throw new ArgError(`days[${i}].notes must be a string.`);
    }

    await upsertPlanDay(ctx, {
      weekday: wd,
      kind,
      label: (label as string | undefined)?.trim() || null,
      notes: (notes as string | undefined)?.trim() || null,
    });
    written.push(`${WEEKDAY_NAMES[wd]}: ${kind}${label ? ` — ${label}` : ''}`);
  }

  const plan = await getTrainingPlan(ctx);
  return { saved: true, days_written: written, plan_now: plan };
}

/**
 * What today is meant to be, and when the next lift day falls.
 *
 * Facts only. Whether to actually train, push, or skip is judgement and lives
 * in the Skill — this just says what the user told us the week looks like.
 */
export async function getTrainingPlanTool(ctx: Ctx, _args: ToolArgs): Promise<unknown> {
  const plan = await getTrainingPlan(ctx);
  const view = planView(plan, todayIndex(ctx));
  return {
    today: view.today,
    next_lift: view.next_lift,
    plan: plan.map((d) => ({ ...d, weekday_name: WEEKDAY_NAMES[d.weekday] })),
    // Distinguishes "no plan set up" from "today is a rest day", which read the
    // same on screen but mean opposite things.
    no_plan_set: view.empty,
  };
}
