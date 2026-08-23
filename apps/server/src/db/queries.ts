/**
 * D1 access. Every query is user-scoped by an explicit `userId` argument that
 * the caller derives from the credential — never from tool arguments
 * (ARCHITECTURE.md pitfall #4).
 */

import type { MealRow, GoalRow } from '../domain/totals.ts';
import type { SetRow } from '../domain/progression.ts';

export interface Ctx {
  db: D1Database;
  userId: string;
  tz: string;
  now: Date;
}

export async function ensureUser(ctx: Ctx): Promise<void> {
  await ctx.db
    .prepare('INSERT OR IGNORE INTO users (id, tz, units, created_at) VALUES (?, ?, ?, ?)')
    .bind(ctx.userId, ctx.tz, 'imperial', ctx.now.toISOString())
    .run();
}

export async function getUserTz(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT tz FROM users WHERE id = ?').bind(userId).first<{ tz: string }>();
  return row?.tz ?? null;
}

// ---------- meals ----------

export interface NewMeal {
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
}

export async function insertMeal(ctx: Ctx, m: NewMeal): Promise<string> {
  const id = crypto.randomUUID();
  const iso = ctx.now.toISOString();
  await ctx.db
    .prepare(
      `INSERT INTO meals (id, user_id, logged_at, local_date, meal_type, description,
         kcal, protein_g, fat_g, carb_g, fiber_g, alcohol_g, confidence, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, ctx.userId, iso, m.local_date, m.meal_type, m.description,
      m.kcal, m.protein_g, m.fat_g, m.carb_g, m.fiber_g, m.alcohol_g,
      m.confidence, m.source, iso,
    )
    .run();
  return id;
}

export async function getMealsForDate(ctx: Ctx, date: string): Promise<MealRow[]> {
  const res = await ctx.db
    .prepare(
      `SELECT id, local_date, meal_type, description, kcal, protein_g, fat_g, carb_g,
              fiber_g, alcohol_g, confidence, source, logged_at
         FROM meals
        WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL
        ORDER BY logged_at ASC`,
    )
    .bind(ctx.userId, date)
    .all<MealRow>();
  return res.results ?? [];
}

export async function getMealsForRange(ctx: Ctx, start: string, end: string): Promise<MealRow[]> {
  const res = await ctx.db
    .prepare(
      `SELECT id, local_date, meal_type, description, kcal, protein_g, fat_g, carb_g,
              fiber_g, alcohol_g, confidence, source, logged_at
         FROM meals
        WHERE user_id = ? AND local_date BETWEEN ? AND ? AND deleted_at IS NULL
        ORDER BY local_date ASC, logged_at ASC`,
    )
    .bind(ctx.userId, start, end)
    .all<MealRow>();
  return res.results ?? [];
}

// ---------- workouts ----------

export interface NewSet {
  exercise: string;
  exercise_raw: string | null;
  set_no: number;
  reps: number | null;
  weight_lb: number | null;
  rpe: number | null;
  completed: boolean;
}

export async function insertWorkout(
  ctx: Ctx,
  localDate: string,
  sessionLabel: string | null,
  notes: string | null,
  sets: NewSet[],
): Promise<{ workoutId: string; setCount: number }> {
  const workoutId = crypto.randomUUID();
  const iso = ctx.now.toISOString();

  const stmts: D1PreparedStatement[] = [
    ctx.db
      .prepare(
        `INSERT INTO workouts (id, user_id, local_date, session_label, notes, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(workoutId, ctx.userId, localDate, sessionLabel, notes, iso),
  ];

  for (const s of sets) {
    stmts.push(
      ctx.db
        .prepare(
          `INSERT INTO sets (id, workout_id, exercise, exercise_raw, set_no, reps,
             weight_lb, rpe, completed, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(), workoutId, s.exercise, s.exercise_raw, s.set_no,
          s.reps, s.weight_lb, s.rpe, s.completed ? 1 : 0, iso,
        ),
    );
  }

  // batch() is atomic in D1 — a half-written workout is worse than a failed one.
  await ctx.db.batch(stmts);
  return { workoutId, setCount: sets.length };
}

/** Sets for one exercise, most recent `sessionLimit` sessions. */
export async function getSetsForExercise(
  ctx: Ctx,
  exercise: string,
  sessionLimit = 4,
): Promise<SetRow[]> {
  const res = await ctx.db
    .prepare(
      `SELECT s.exercise, s.exercise_raw, s.set_no, s.reps, s.weight_lb, s.rpe,
              s.completed, w.local_date, w.session_label
         FROM sets s
         JOIN workouts w ON w.id = s.workout_id
        WHERE w.user_id = ? AND s.exercise = ? AND w.deleted_at IS NULL
          AND w.local_date IN (
            SELECT DISTINCT w2.local_date
              FROM sets s2 JOIN workouts w2 ON w2.id = s2.workout_id
             WHERE w2.user_id = ? AND s2.exercise = ? AND w2.deleted_at IS NULL
             ORDER BY w2.local_date DESC
             LIMIT ?
          )
        ORDER BY w.local_date DESC, s.set_no ASC`,
    )
    .bind(ctx.userId, exercise, ctx.userId, exercise, sessionLimit)
    .all<SetRow>();
  return res.results ?? [];
}

export async function countSessionsInRange(ctx: Ctx, start: string, end: string): Promise<number> {
  const row = await ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM workouts
        WHERE user_id = ? AND local_date BETWEEN ? AND ? AND deleted_at IS NULL`,
    )
    .bind(ctx.userId, start, end)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getLastWorkoutDate(ctx: Ctx): Promise<string | null> {
  const row = await ctx.db
    .prepare(
      `SELECT local_date FROM workouts
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY local_date DESC LIMIT 1`,
    )
    .bind(ctx.userId)
    .first<{ local_date: string }>();
  return row?.local_date ?? null;
}

// ---------- bodyweight ----------

export async function upsertBodyweight(
  ctx: Ctx,
  localDate: string,
  weightLb: number | null,
  waistIn: number | null,
): Promise<void> {
  // COALESCE on update so logging only a waist measurement keeps the day's weight.
  await ctx.db
    .prepare(
      `INSERT INTO bodyweight (id, user_id, local_date, weight_lb, waist_in)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, local_date) DO UPDATE SET
         weight_lb = COALESCE(excluded.weight_lb, weight_lb),
         waist_in  = COALESCE(excluded.waist_in,  waist_in)`,
    )
    .bind(crypto.randomUUID(), ctx.userId, localDate, weightLb, waistIn)
    .run();
}

export async function getBodyweightRange(
  ctx: Ctx,
  start: string,
  end: string,
): Promise<{ local_date: string; weight_lb: number | null; waist_in: number | null }[]> {
  const res = await ctx.db
    .prepare(
      `SELECT local_date, weight_lb, waist_in FROM bodyweight
        WHERE user_id = ? AND local_date BETWEEN ? AND ?
        ORDER BY local_date ASC`,
    )
    .bind(ctx.userId, start, end)
    .all<{ local_date: string; weight_lb: number | null; waist_in: number | null }>();
  return res.results ?? [];
}

// ---------- goals ----------

export async function insertGoals(ctx: Ctx, effectiveFrom: string, g: GoalRow): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.db
    .prepare(
      `INSERT INTO goals (id, user_id, effective_from, kcal, protein_g, fat_g, carb_g,
         target_weight_lb, weekly_sessions)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, ctx.userId, effectiveFrom, g.kcal, g.protein_g, g.fat_g, g.carb_g,
      g.target_weight_lb, g.weekly_sessions,
    )
    .run();
  return id;
}

/** Goals in force on `date`. Versioned, never overwritten — take the latest <= date. */
export async function getGoalsAsOf(ctx: Ctx, date: string): Promise<GoalRow | null> {
  const row = await ctx.db
    .prepare(
      `SELECT kcal, protein_g, fat_g, carb_g, target_weight_lb, weekly_sessions
         FROM goals
        WHERE user_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC LIMIT 1`,
    )
    .bind(ctx.userId, date)
    .first<GoalRow>();
  return row ?? null;
}
