/**
 * Day and week aggregation. Arithmetic only — no opinions (README §4, principle 6).
 *
 * The one non-obvious rule: alcohol is separated, never folded into carbs.
 * A 2,100 kcal day with 520 from wine is a 1,580 kcal *food* day, which is a
 * materially different day. The Skill needs both numbers to say anything true.
 */

export interface MealRow {
  id: string;
  local_date: string;
  meal_type: string | null;
  description: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fiber_g: number | null;
  alcohol_g: number;
  confidence: string;
  source: string;
  logged_at: string;
  /** Set when the meal was logged from a recipe card. Phase 2.5. */
  recipe_slug?: string | null;
}

export interface GoalRow {
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  target_weight_lb: number | null;
  weekly_sessions: number | null;
}

export interface Totals {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fiber_g: number;
  alcohol_g: number;
  /** kcal attributable to ethanol at 7 kcal/g. */
  alcohol_kcal: number;
  /** Total kcal minus alcohol kcal. The number that actually drives decisions. */
  food_kcal: number;
}

/** kcal per gram of pure ethanol. */
export const KCAL_PER_G_ALCOHOL = 7;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function sumMeals(meals: MealRow[]): Totals {
  const t = meals.reduce(
    (a, m) => ({
      kcal: a.kcal + (m.kcal || 0),
      protein_g: a.protein_g + (m.protein_g || 0),
      fat_g: a.fat_g + (m.fat_g || 0),
      carb_g: a.carb_g + (m.carb_g || 0),
      fiber_g: a.fiber_g + (m.fiber_g || 0),
      alcohol_g: a.alcohol_g + (m.alcohol_g || 0),
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, alcohol_g: 0 },
  );
  const alcohol_kcal = t.alcohol_g * KCAL_PER_G_ALCOHOL;
  return {
    kcal: r1(t.kcal),
    protein_g: r1(t.protein_g),
    fat_g: r1(t.fat_g),
    carb_g: r1(t.carb_g),
    fiber_g: r1(t.fiber_g),
    alcohol_g: r1(t.alcohol_g),
    alcohol_kcal: r1(alcohol_kcal),
    // Clamped at 0: a mis-entered alcohol_g shouldn't produce negative food kcal.
    food_kcal: r1(Math.max(0, t.kcal - alcohol_kcal)),
  };
}

export interface Remaining {
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
}

/** Goal minus eaten. null for any macro with no goal set — not zero. */
export function remainingVsGoals(totals: Totals, goals: GoalRow | null): Remaining {
  const rem = (goal: number | null | undefined, eaten: number) =>
    goal === null || goal === undefined ? null : r1(goal - eaten);
  return {
    kcal: rem(goals?.kcal, totals.kcal),
    protein_g: rem(goals?.protein_g, totals.protein_g),
    fat_g: rem(goals?.fat_g, totals.fat_g),
    carb_g: rem(goals?.carb_g, totals.carb_g),
  };
}

export interface WeekSummary {
  days_with_data: number;
  days_in_window: number;
  avg_kcal: number | null;
  avg_food_kcal: number | null;
  avg_protein_g: number | null;
  avg_alcohol_g: number | null;
  /** Share of logged days that hit the protein goal. null if no protein goal. */
  protein_adherence_pct: number | null;
  bodyweight_avg_lb: number | null;
  bodyweight_readings: number;
  waist_avg_in: number | null;
  sessions: number;
}

/**
 * Averages over the days that actually have data, not over the window.
 * Dividing by 7 when only 3 days were logged reports a fake deficit.
 */
export function summarizeWeek(
  mealsByDate: Map<string, MealRow[]>,
  window: string[],
  goals: GoalRow | null,
  bodyweights: { weight_lb: number | null; waist_in: number | null }[],
  sessionCount: number,
): WeekSummary {
  const dayTotals = window
    .map((d) => mealsByDate.get(d))
    .filter((ms): ms is MealRow[] => !!ms && ms.length > 0)
    .map(sumMeals);

  const n = dayTotals.length;
  const avg = (pick: (t: Totals) => number) =>
    n === 0 ? null : r1(dayTotals.reduce((a, t) => a + pick(t), 0) / n);

  const proteinGoal = goals?.protein_g ?? null;
  const hits = proteinGoal === null ? 0 : dayTotals.filter((t) => t.protein_g >= proteinGoal).length;

  const weights = bodyweights.map((b) => b.weight_lb).filter((w): w is number => w !== null);
  const waists = bodyweights.map((b) => b.waist_in).filter((w): w is number => w !== null);

  return {
    days_with_data: n,
    days_in_window: window.length,
    avg_kcal: avg((t) => t.kcal),
    avg_food_kcal: avg((t) => t.food_kcal),
    avg_protein_g: avg((t) => t.protein_g),
    avg_alcohol_g: avg((t) => t.alcohol_g),
    protein_adherence_pct: proteinGoal === null || n === 0 ? null : Math.round((hits / n) * 100),
    bodyweight_avg_lb: weights.length ? r1(weights.reduce((a, b) => a + b, 0) / weights.length) : null,
    bodyweight_readings: weights.length,
    waist_avg_in: waists.length ? r1(waists.reduce((a, b) => a + b, 0) / waists.length) : null,
    sessions: sessionCount,
  };
}
