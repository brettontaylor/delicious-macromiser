import type { Ctx, NewMeal } from '../../db/queries.ts';
import { insertMeal, insertWorkout, upsertBodyweight } from '../../db/queries.ts';
import type { ToolArgs } from './index.ts';
import { ArgError } from './args.ts';
import { parseSets } from './sets.ts';
import { isValidDate } from '../../util/date.ts';

const MAX_DAYS = 60;
const MAX_MEALS_PER_DAY = 20;
const CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Backfill many days in one call.
 *
 * The reason this exists is not database efficiency — it is the client. Every
 * tool call is a separate approval prompt, so reconstructing a month of history
 * through `log_meal` meant dozens of interruptions and a real chance of the run
 * being abandoned half-written. One call is one approval.
 *
 * Everything written here is tagged `source='import'`, because a reconstructed
 * entry is weaker evidence than one captured as it happened and the trend views
 * need to be able to tell them apart.
 *
 * Not idempotent for meals and workouts. Running it twice writes twice.
 * Bodyweight upserts on (user, date), so only that one self-corrects.
 */
export async function importDays(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const raw = args['days'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('"days" is required and must be a non-empty array.');
  }
  if (raw.length > MAX_DAYS) {
    throw new ArgError(`"days" is capped at ${MAX_DAYS} per call. Split the import.`);
  }

  const seen = new Set<string>();
  const written: {
    date: string;
    meals: number;
    kcal: number;
    sets: number;
    bodyweight: boolean;
  }[] = [];
  const incomplete: string[] = [];

  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`days[${i}] must be an object.`);
    }
    const d = entry as Record<string, unknown>;

    const date = d['date'];
    if (typeof date !== 'string' || !isValidDate(date)) {
      throw new ArgError(`days[${i}].date must be a valid YYYY-MM-DD date.`);
    }
    if (seen.has(date)) {
      throw new ArgError(`days[${i}]: ${date} appears twice. Merge the two entries.`);
    }
    seen.add(date);

    const tally = { date, meals: 0, kcal: 0, sets: 0, bodyweight: false };

    // ---------- meals ----------
    const meals = d['meals'];
    if (meals !== undefined && meals !== null) {
      if (!Array.isArray(meals)) throw new ArgError(`days[${i}].meals must be an array.`);
      if (meals.length > MAX_MEALS_PER_DAY) {
        throw new ArgError(`days[${i}].meals is capped at ${MAX_MEALS_PER_DAY}.`);
      }

      for (const [j, m] of meals.entries()) {
        if (typeof m !== 'object' || m === null) {
          throw new ArgError(`days[${i}].meals[${j}] must be an object.`);
        }
        const meal = m as Record<string, unknown>;
        const at = `days[${i}].meals[${j}]`;

        const num = (key: string, required: boolean): number => {
          const v = meal[key];
          if (v === undefined || v === null) {
            if (required) throw new ArgError(`${at}.${key} is required.`);
            return 0;
          }
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new ArgError(`${at}.${key} must be a finite number.`);
          }
          if (v < 0) throw new ArgError(`${at}.${key} cannot be negative.`);
          return v;
        };

        const description = meal['description'];
        if (typeof description !== 'string' || description.trim() === '') {
          throw new ArgError(`${at}.description is required.`);
        }
        const confidence = meal['confidence'];
        if (typeof confidence !== 'string' || !CONFIDENCE.has(confidence)) {
          throw new ArgError(`${at}.confidence must be one of: high, medium, low.`);
        }
        const mealType = meal['meal_type'];
        if (mealType !== undefined && mealType !== null && typeof mealType !== 'string') {
          throw new ArgError(`${at}.meal_type must be a string.`);
        }

        const row: NewMeal = {
          local_date: date,
          meal_type: (mealType as string | undefined) ?? null,
          description: description.trim(),
          kcal: num('kcal', true),
          protein_g: num('protein_g', true),
          fat_g: num('fat_g', true),
          carb_g: num('carb_g', true),
          fiber_g: meal['fiber_g'] === undefined || meal['fiber_g'] === null ? null : num('fiber_g', false),
          alcohol_g: num('alcohol_g', false),
          confidence,
          source: 'import',
        };
        await insertMeal(ctx, row);
        tally.meals += 1;
        tally.kcal += row.kcal;
      }
    }

    // ---------- workout ----------
    const workout = d['workout'];
    if (workout !== undefined && workout !== null) {
      if (typeof workout !== 'object') throw new ArgError(`days[${i}].workout must be an object.`);
      const w = workout as Record<string, unknown>;
      const parsed = parseSets(w['sets'], `days[${i}].workout.sets`);
      const label = typeof w['session_label'] === 'string' ? w['session_label'] : null;
      const notes = typeof w['notes'] === 'string' ? w['notes'] : null;

      const { setCount } = await insertWorkout(ctx, date, label, notes, parsed.sets);
      tally.sets = setCount;
      for (const note of parsed.incomplete) incomplete.push(`${date}: ${note}`);
    }

    // ---------- bodyweight ----------
    const bw = d['bodyweight'];
    if (bw !== undefined && bw !== null) {
      if (typeof bw !== 'object') throw new ArgError(`days[${i}].bodyweight must be an object.`);
      const b = bw as Record<string, unknown>;

      const opt = (key: string, max: number): number | null => {
        const v = b[key];
        if (v === undefined || v === null) return null;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ArgError(`days[${i}].bodyweight.${key} must be a finite number.`);
        }
        if (v <= 0 || v > max) {
          throw new ArgError(`days[${i}].bodyweight.${key} is outside a plausible range.`);
        }
        return v;
      };

      const weight = opt('weight_lb', 1000);
      const waist = opt('waist_in', 100);
      if (weight === null && waist === null) {
        throw new ArgError(`days[${i}].bodyweight needs at least one of weight_lb or waist_in.`);
      }
      await upsertBodyweight(ctx, date, weight, waist);
      tally.bodyweight = true;
    }

    written.push(tally);
  }

  written.sort((a, b) => a.date.localeCompare(b.date));

  return {
    imported: true,
    days: written.length,
    date_range: { start: written[0]!.date, end: written[written.length - 1]!.date },
    totals: {
      meals: written.reduce((n, d) => n + d.meals, 0),
      sets: written.reduce((n, d) => n + d.sets, 0),
      bodyweight_days: written.filter((d) => d.bodyweight).length,
    },
    per_day: written,
    // Non-empty means the write succeeded with gaps. Report these rather than
    // presenting the backfill as complete.
    incomplete_sets: incomplete,
    source: 'import',
    note: 'Not idempotent — running this again writes duplicate meals and workouts.',
  };
}
