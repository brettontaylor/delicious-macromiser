import type { Ctx } from '../../db/queries.ts';
import {
  getMealsForRange,
  getGoalsAsOf,
  getBodyweightRange,
  countSessionsInRange,
} from '../../db/queries.ts';
import { summarizeWeek } from '../../domain/totals.ts';
import type { MealRow } from '../../domain/totals.ts';
import { shiftDate, dateRange, isValidDate, localDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, optInt, optString } from './args.ts';

/**
 * The only honest progress view. Averages are computed over days that have
 * data, and `days_with_data` comes back alongside so a sparse week can be
 * called sparse instead of read as a deficit.
 */
export async function getWeekSummary(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const days = optInt(args, 'days') ?? 7;
  if (days < 1 || days > 90) throw new ArgError('"days" must be between 1 and 90.');

  const endRaw = optString(args, 'end_date');
  if (endRaw !== null && !isValidDate(endRaw)) {
    throw new ArgError('"end_date" must be a valid date in YYYY-MM-DD form.');
  }
  const end = endRaw ?? localDate(ctx.now, ctx.tz);
  const start = shiftDate(end, -(days - 1));

  const [meals, goals, bodyweights, sessions] = await Promise.all([
    getMealsForRange(ctx, start, end),
    getGoalsAsOf(ctx, end),
    getBodyweightRange(ctx, start, end),
    countSessionsInRange(ctx, start, end),
  ]);

  const byDate = new Map<string, MealRow[]>();
  for (const m of meals) {
    const bucket = byDate.get(m.local_date);
    if (bucket) bucket.push(m);
    else byDate.set(m.local_date, [m]);
  }

  const window = dateRange(start, end);
  const summary = summarizeWeek(byDate, window, goals, bodyweights, sessions);

  // First-half vs second-half so a trend is visible without a second call.
  const half = Math.floor(window.length / 2);
  const trendWeights = (slice: string[]) => {
    const xs = bodyweights
      .filter((b) => slice.includes(b.local_date) && b.weight_lb !== null)
      .map((b) => b.weight_lb!);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };
  const firstHalf = trendWeights(window.slice(0, half));
  const secondHalf = trendWeights(window.slice(half));

  return {
    start_date: start,
    end_date: end,
    goals,
    ...summary,
    weight_trend:
      firstHalf !== null && secondHalf !== null
        ? { first_half_avg_lb: firstHalf, second_half_avg_lb: secondHalf, delta_lb: Math.round((secondHalf - firstHalf) * 10) / 10 }
        : null,
    // Stated plainly so a thin week is reported as thin, not as a result.
    data_quality:
      summary.days_with_data === 0
        ? 'no_data'
        : summary.days_with_data < Math.ceil(window.length * 0.6)
          ? 'sparse'
          : 'adequate',
  };
}
