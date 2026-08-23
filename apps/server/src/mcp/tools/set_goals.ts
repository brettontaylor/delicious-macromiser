import type { Ctx } from '../../db/queries.ts';
import { insertGoals, getGoalsAsOf } from '../../db/queries.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, optNumber, optInt, optLocalDate } from './args.ts';

/**
 * Inserts a new versioned row rather than updating. Past days stay scored
 * against the targets that were actually in force then.
 *
 * Unspecified fields carry forward from the previous version, so "bump protein
 * to 180" does not silently drop the calorie target.
 */
export async function setGoals(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const effectiveFrom = optLocalDate(args, 'effective_from', ctx.now, ctx.tz);
  const prior = await getGoalsAsOf(ctx, effectiveFrom);

  const kcal = optNumber(args, 'kcal');
  const protein = optNumber(args, 'protein_g');
  const fat = optNumber(args, 'fat_g');
  const carb = optNumber(args, 'carb_g');
  const targetWeight = optNumber(args, 'target_weight_lb');
  const weeklySessions = optInt(args, 'weekly_sessions');

  if (
    kcal === null && protein === null && fat === null && carb === null &&
    targetWeight === null && weeklySessions === null
  ) {
    throw new ArgError('Provide at least one goal field to set.');
  }
  for (const [k, v] of Object.entries({ kcal, protein_g: protein, fat_g: fat, carb_g: carb })) {
    if (v !== null && v < 0) throw new ArgError(`"${k}" cannot be negative.`);
  }

  const merged = {
    kcal: kcal ?? prior?.kcal ?? null,
    protein_g: protein ?? prior?.protein_g ?? null,
    fat_g: fat ?? prior?.fat_g ?? null,
    carb_g: carb ?? prior?.carb_g ?? null,
    target_weight_lb: targetWeight ?? prior?.target_weight_lb ?? null,
    weekly_sessions: weeklySessions ?? prior?.weekly_sessions ?? null,
  };

  const id = await insertGoals(ctx, effectiveFrom, merged);

  return {
    saved: true,
    goal_id: id,
    effective_from: effectiveFrom,
    goals: merged,
    carried_forward: prior !== null,
    // The Skill's guardrails need to know if a target it did not set is now active.
    changed_fields: Object.entries({
      kcal, protein_g: protein, fat_g: fat, carb_g: carb,
      target_weight_lb: targetWeight, weekly_sessions: weeklySessions,
    })
      .filter(([, v]) => v !== null)
      .map(([k]) => k),
  };
}
