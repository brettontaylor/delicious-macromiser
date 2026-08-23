import type { Ctx } from '../../db/queries.ts';
import { upsertBodyweight, getBodyweightRange } from '../../db/queries.ts';
import { shiftDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, optNumber, optLocalDate } from './args.ts';

/**
 * Returns the 7-day rolling average alongside the reading, because a single
 * weigh-in is noise and the Skill is required to report the average instead
 * (COACHING-LAYER.md §5). Handing back both removes the temptation to quote
 * the raw number.
 */
export async function logBodyweight(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const date = optLocalDate(args, 'date', ctx.now, ctx.tz);
  const weight = optNumber(args, 'weight_lb');
  const waist = optNumber(args, 'waist_in');

  if (weight === null && waist === null) {
    throw new ArgError('Provide at least one of "weight_lb" or "waist_in".');
  }
  if (weight !== null && (weight <= 0 || weight > 1000)) {
    throw new ArgError('"weight_lb" is outside a plausible range.');
  }
  if (waist !== null && (waist <= 0 || waist > 100)) {
    throw new ArgError('"waist_in" is outside a plausible range.');
  }

  await upsertBodyweight(ctx, date, weight, waist);

  const window = await getBodyweightRange(ctx, shiftDate(date, -6), date);
  const weights = window.map((r) => r.weight_lb).filter((w): w is number => w !== null);
  const waists = window.map((r) => r.waist_in).filter((w): w is number => w !== null);
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

  return {
    logged: true,
    local_date: date,
    weight_lb: weight,
    waist_in: waist,
    rolling_7d: {
      weight_avg_lb: avg(weights),
      weight_readings: weights.length,
      waist_avg_in: avg(waists),
      waist_readings: waists.length,
    },
  };
}
