/**
 * D1 access. Every query is user-scoped by an explicit `userId` argument that
 * the caller derives from the credential — never from tool arguments
 * (ARCHITECTURE.md pitfall #4).
 */

import type { MealRow, GoalRow } from '../domain/totals.ts';
import type { SetRow } from '../domain/progression.ts';

export interface Ctx {
  /** Meal photos. Optional — text capture works without it. */
  captures?: R2Bucket;
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
  recipe_slug: string | null;
  /** Set when the meal came from an app capture. US-1 Phase 1. */
  capture_id?: string | null;
}

export async function insertMeal(ctx: Ctx, m: NewMeal): Promise<string> {
  const id = crypto.randomUUID();
  const iso = ctx.now.toISOString();
  await ctx.db
    .prepare(
      `INSERT INTO meals (id, user_id, logged_at, local_date, meal_type, description,
         kcal, protein_g, fat_g, carb_g, fiber_g, alcohol_g, confidence, source,
         recipe_slug, capture_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, ctx.userId, iso, m.local_date, m.meal_type, m.description,
      m.kcal, m.protein_g, m.fat_g, m.carb_g, m.fiber_g, m.alcohol_g,
      m.confidence, m.source, m.recipe_slug ?? null, m.capture_id ?? null, iso,
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
              s.completed, w.local_date, w.session_label, w.id AS workout_id
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

// ---------- corrections (Phase 3) ----------

export interface MealPatch {
  description?: string;
  kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  fiber_g?: number | null;
  alcohol_g?: number;
  meal_type?: string | null;
}

/**
 * Returns the row as it stands, so a caller can show the user what they are
 * about to change and so a patch can be validated against real values.
 * Soft-deleted rows are invisible here — correcting a deleted meal is a bug.
 */
export async function getMealById(ctx: Ctx, id: string): Promise<MealRow | null> {
  const row = await ctx.db
    .prepare(
      `SELECT id, local_date, meal_type, description, kcal, protein_g, fat_g, carb_g,
              fiber_g, alcohol_g, confidence, source, recipe_slug, logged_at
         FROM meals
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, ctx.userId)
    .first<MealRow>();
  return row ?? null;
}

/**
 * Applies a partial correction. Always sets source='corrected' — the point of
 * the column is to distinguish a number the user has actually looked at from
 * one nobody has checked, and an edit is exactly that signal.
 *
 * Confidence is raised to 'high' for the same reason: a human just confirmed it.
 */
export async function updateMeal(ctx: Ctx, id: string, patch: MealPatch): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return false;

  sets.push(`source = 'corrected'`, `confidence = 'high'`);
  vals.push(id, ctx.userId);

  const res = await ctx.db
    .prepare(
      `UPDATE meals SET ${sets.join(', ')}
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Soft delete. Every read already filters `deleted_at IS NULL`, and keeping the
 *  row means a mistaken delete is recoverable without reaching for a backup. */
export async function softDeleteMeal(ctx: Ctx, id: string): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE meals SET deleted_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctx.now.toISOString(), id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * A corrected portion becomes reusable. This is the loop nothing else in this
 * space closes: fix "8oz chicken breast" once and the next estimate of the same
 * phrase starts from the corrected number instead of from scratch.
 */
export async function rememberPortion(
  ctx: Ctx,
  phrase: string,
  m: { kcal: number; protein_g: number; fat_g: number; carb_g: number },
): Promise<void> {
  await ctx.db
    .prepare(
      `INSERT INTO portion_memory (id, user_id, phrase, kcal, protein_g, fat_g, carb_g,
         times_used, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?)
       ON CONFLICT(user_id, phrase) DO UPDATE SET
         kcal = excluded.kcal, protein_g = excluded.protein_g,
         fat_g = excluded.fat_g, carb_g = excluded.carb_g,
         times_used = portion_memory.times_used + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), ctx.userId, phrase.trim().toLowerCase(),
          m.kcal, m.protein_g, m.fat_g, m.carb_g, ctx.now.toISOString())
    .run();
}

export async function lookupPortions(
  ctx: Ctx,
  limit = 25,
): Promise<{ phrase: string; kcal: number | null; protein_g: number | null;
             fat_g: number | null; carb_g: number | null; times_used: number }[]> {
  const res = await ctx.db
    .prepare(
      `SELECT phrase, kcal, protein_g, fat_g, carb_g, times_used
         FROM portion_memory WHERE user_id = ?
        ORDER BY times_used DESC, updated_at DESC LIMIT ?`,
    )
    .bind(ctx.userId, limit)
    .all<{ phrase: string; kcal: number | null; protein_g: number | null;
           fat_g: number | null; carb_g: number | null; times_used: number }>();
  return res.results ?? [];
}

// ---------- captures (US-1 Phase 1) ----------

export interface CaptureRow {
  id: string;
  created_at: string;
  local_date: string;
  kind: string;
  note: string | null;
  object_key: string | null;
  mime_type: string | null;
  bytes: number | null;
  state: string;
}

export async function insertCapture(
  ctx: Ctx,
  c: { local_date: string; kind: string; note: string | null;
       object_key?: string | null; mime_type?: string | null; bytes?: number | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.db
    .prepare(
      `INSERT INTO captures (id, user_id, created_at, local_date, kind, note,
         object_key, mime_type, bytes, state)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
    )
    .bind(id, ctx.userId, ctx.now.toISOString(), c.local_date, c.kind, c.note,
          c.object_key ?? null, c.mime_type ?? null, c.bytes ?? null)
    .run();
  return id;
}

/** Oldest first — a queue should drain in the order things happened. */
export async function listPendingCaptures(ctx: Ctx, limit = 20): Promise<CaptureRow[]> {
  const res = await ctx.db
    .prepare(
      `SELECT id, created_at, local_date, kind, note, object_key, mime_type, bytes, state
         FROM captures
        WHERE user_id = ? AND state = 'pending'
        ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(ctx.userId, limit)
    .all<CaptureRow>();
  return res.results ?? [];
}

export async function countPendingCaptures(ctx: Ctx): Promise<number> {
  const row = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM captures WHERE user_id = ? AND state = 'pending'`)
    .bind(ctx.userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getCaptureById(ctx: Ctx, id: string): Promise<CaptureRow | null> {
  const row = await ctx.db
    .prepare(
      `SELECT id, created_at, local_date, kind, note, object_key, mime_type, bytes, state
         FROM captures WHERE id = ? AND user_id = ?`,
    )
    .bind(id, ctx.userId)
    .first<CaptureRow>();
  return row ?? null;
}

/**
 * Close a capture. Guarded on `state = 'pending'` so a second attempt is a
 * no-op rather than a silent overwrite — the queue must not double-log.
 * Returns false when it was already resolved.
 */
export async function resolveCaptureRow(
  ctx: Ctx,
  id: string,
  state: 'logged' | 'unusable',
  opts: { mealId?: string | null; reason?: string | null } = {},
): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE captures SET state = ?, meal_id = ?, reason = ?, resolved_at = ?
        WHERE id = ? AND user_id = ? AND state = 'pending'`,
    )
    .bind(state, opts.mealId ?? null, opts.reason ?? null,
          ctx.now.toISOString(), id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- workout corrections ----------

export interface WorkoutDetail {
  id: string;
  local_date: string;
  session_label: string | null;
  notes: string | null;
  sets: {
    id: string; exercise: string; exercise_raw: string | null;
    set_no: number; reps: number | null; weight_lb: number | null;
    rpe: number | null; completed: number;
  }[];
}

export async function getWorkoutById(ctx: Ctx, id: string): Promise<WorkoutDetail | null> {
  const w = await ctx.db
    .prepare(
      `SELECT id, local_date, session_label, notes FROM workouts
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, ctx.userId)
    .first<{ id: string; local_date: string; session_label: string | null; notes: string | null }>();
  if (!w) return null;

  const res = await ctx.db
    .prepare(
      `SELECT id, exercise, exercise_raw, set_no, reps, weight_lb, rpe, completed
         FROM sets WHERE workout_id = ? ORDER BY set_no ASC`,
    )
    .bind(id)
    .all<WorkoutDetail['sets'][number]>();

  return { ...w, sets: res.results ?? [] };
}

/** Most recent sessions, so a correction can be aimed without knowing an id. */
export async function recentWorkoutIds(
  ctx: Ctx,
  limit = 10,
): Promise<{ id: string; local_date: string; session_label: string | null; set_count: number }[]> {
  const res = await ctx.db
    .prepare(
      `SELECT w.id, w.local_date, w.session_label, COUNT(s.id) AS set_count
         FROM workouts w LEFT JOIN sets s ON s.workout_id = w.id
        WHERE w.user_id = ? AND w.deleted_at IS NULL
        GROUP BY w.id ORDER BY w.local_date DESC, w.created_at DESC LIMIT ?`,
    )
    .bind(ctx.userId, limit)
    .all<{ id: string; local_date: string; session_label: string | null; set_count: number }>();
  return res.results ?? [];
}

export interface SetPatch {
  reps?: number | null;
  weight_lb?: number | null;
  rpe?: number | null;
  completed?: boolean;
}

/** Patch one set of a workout, addressed by its position in the session. */
export async function updateSet(
  ctx: Ctx,
  workoutId: string,
  setNo: number,
  patch: SetPatch,
): Promise<boolean> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cols.push(`${k} = ?`);
    vals.push(k === 'completed' ? (v ? 1 : 0) : v);
  }
  if (cols.length === 0) return false;
  vals.push(workoutId, setNo);

  const res = await ctx.db
    .prepare(`UPDATE sets SET ${cols.join(', ')} WHERE workout_id = ? AND set_no = ?`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Hard delete — `sets` has no `deleted_at`, and a set removed because it never
 * happened has no history worth keeping. The parent workout is still soft
 * deleted, so a whole session remains recoverable.
 */
export async function deleteSet(ctx: Ctx, workoutId: string, setNo: number): Promise<boolean> {
  const res = await ctx.db
    .prepare(`DELETE FROM sets WHERE workout_id = ? AND set_no = ?`)
    .bind(workoutId, setNo)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function updateWorkoutMeta(
  ctx: Ctx,
  id: string,
  patch: { session_label?: string | null; notes?: string | null },
): Promise<boolean> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  if (cols.length === 0) return false;
  vals.push(id, ctx.userId);
  const res = await ctx.db
    .prepare(`UPDATE workouts SET ${cols.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function softDeleteWorkout(ctx: Ctx, id: string): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE workouts SET deleted_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctx.now.toISOString(), id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- training plan ----------

export interface PlanDay {
  weekday: number;
  kind: string;
  label: string | null;
  notes: string | null;
}

export async function getTrainingPlan(ctx: Ctx): Promise<PlanDay[]> {
  const res = await ctx.db
    .prepare(
      `SELECT weekday, kind, label, notes FROM training_plan
        WHERE user_id = ? ORDER BY weekday ASC`,
    )
    .bind(ctx.userId)
    .all<PlanDay>();
  return res.results ?? [];
}

/** Upsert one day. The plan is small and changes rarely; a whole-week replace
 *  would make "just move leg day" into a rewrite of everything. */
export async function upsertPlanDay(ctx: Ctx, d: PlanDay): Promise<void> {
  await ctx.db
    .prepare(
      `INSERT INTO training_plan (user_id, weekday, kind, label, notes, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, weekday) DO UPDATE SET
         kind = excluded.kind, label = excluded.label,
         notes = excluded.notes, updated_at = excluded.updated_at`,
    )
    .bind(ctx.userId, d.weekday, d.kind, d.label, d.notes, ctx.now.toISOString())
    .run();
}

// ---------- pantry ----------

export interface PantryItem {
  item: string;
  kind: string;
  added_at: string;
}

export async function getPantry(ctx: Ctx): Promise<PantryItem[]> {
  const res = await ctx.db
    .prepare(`SELECT item, kind, added_at FROM pantry WHERE user_id = ? ORDER BY kind, item`)
    .bind(ctx.userId)
    .all<PantryItem>();
  return res.results ?? [];
}

export async function addPantryItem(ctx: Ctx, item: string, kind: string): Promise<void> {
  await ctx.db
    .prepare(
      `INSERT INTO pantry (user_id, item, kind, added_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, item) DO UPDATE SET kind = excluded.kind`,
    )
    .bind(ctx.userId, item.trim().toLowerCase(), kind, ctx.now.toISOString())
    .run();
}

export async function removePantryItem(ctx: Ctx, item: string): Promise<boolean> {
  const res = await ctx.db
    .prepare(`DELETE FROM pantry WHERE user_id = ? AND item = ?`)
    .bind(ctx.userId, item.trim().toLowerCase())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Clear one list without touching the other — "what's fresh" is retyped often,
 *  staples almost never. */
export async function clearPantryKind(ctx: Ctx, kind: string): Promise<number> {
  const res = await ctx.db
    .prepare(`DELETE FROM pantry WHERE user_id = ? AND kind = ?`)
    .bind(ctx.userId, kind)
    .run();
  return res.meta.changes ?? 0;
}

/** How many captures already exist for a day — backs the per-day upload cap. */
export async function countCapturesToday(ctx: Ctx, date: string): Promise<number> {
  const row = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM captures WHERE user_id = ? AND local_date = ?`)
    .bind(ctx.userId, date)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Photo captures older than `days`, whatever their state — the object is
 *  deleted on expiry while the row stays, so the log keeps its history. */
export async function expiredPhotoCaptures(
  ctx: Ctx,
  beforeDate: string,
): Promise<{ id: string; object_key: string }[]> {
  const res = await ctx.db
    .prepare(
      `SELECT id, object_key FROM captures
        WHERE user_id = ? AND object_key IS NOT NULL AND local_date < ?`,
    )
    .bind(ctx.userId, beforeDate)
    .all<{ id: string; object_key: string }>();
  return res.results ?? [];
}

export async function clearCaptureObject(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .prepare(`UPDATE captures SET object_key = NULL WHERE id = ? AND user_id = ?`)
    .bind(id, ctx.userId)
    .run();
}

// ---------- events ----------

export interface NewEvent {
  kind: string;
  label: string;
  starts_on: string;
  ends_on?: string | null;
  caveat_until?: string | null;
  affects?: string;
  notes?: string | null;
}

export interface EventRowDb {
  id: string;
  kind: string;
  label: string;
  starts_on: string;
  ends_on: string | null;
  caveat_until: string | null;
  affects: string;
  notes: string | null;
}

const EVENT_COLS =
  'id, kind, label, starts_on, ends_on, caveat_until, affects, notes';

export async function insertEvent(ctx: Ctx, e: NewEvent): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.db
    .prepare(
      `INSERT INTO events (id, user_id, kind, label, starts_on, ends_on,
         caveat_until, affects, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, ctx.userId, e.kind, e.label, e.starts_on, e.ends_on ?? null,
      e.caveat_until ?? null, e.affects ?? 'none', e.notes ?? null,
      ctx.now.toISOString(),
    )
    .run();
  return id;
}

/**
 * Events overlapping [start, end]. An open-ended event (ends_on NULL) is
 * ongoing and must be included whenever it started on or before `end` — an
 * `ends_on BETWEEN` filter would drop exactly the supplement rows this table
 * was built for.
 */
export async function getEventsInRange(
  ctx: Ctx,
  start: string,
  end: string,
): Promise<EventRowDb[]> {
  const res = await ctx.db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events
        WHERE user_id = ? AND deleted_at IS NULL
          AND starts_on <= ?
          AND (ends_on IS NULL OR ends_on >= ?)
        ORDER BY starts_on DESC`,
    )
    .bind(ctx.userId, end, start)
    .all<EventRowDb>();
  return res.results ?? [];
}

/** Everything not soft-deleted, newest first. For the tool's full listing. */
export async function getAllEvents(ctx: Ctx, limit = 50): Promise<EventRowDb[]> {
  const res = await ctx.db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY starts_on DESC LIMIT ?`,
    )
    .bind(ctx.userId, limit)
    .all<EventRowDb>();
  return res.results ?? [];
}

export async function getEventById(ctx: Ctx, id: string): Promise<EventRowDb | null> {
  const row = await ctx.db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(id, ctx.userId)
    .first<EventRowDb>();
  return row ?? null;
}

export interface EventPatch {
  label?: string;
  starts_on?: string;
  /** null clears the column — "it never ended after all". undefined leaves it. */
  ends_on?: string | null;
  caveat_until?: string | null;
  affects?: string;
  notes?: string | null;
}

/**
 * Partial update, mirroring updateMeal: only the keys actually present are
 * written, so correcting an end date cannot blank a label.
 */
export async function updateEvent(ctx: Ctx, id: string, patch: EventPatch): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of ['label', 'starts_on', 'ends_on', 'caveat_until', 'affects', 'notes'] as const) {
    if (key in patch && patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(patch[key]);
    }
  }
  if (sets.length === 0) return false;
  const res = await ctx.db
    .prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(...vals, id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function softDeleteEvent(ctx: Ctx, id: string): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE events SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctx.now.toISOString(), id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------- personal records ----------

export interface BestSet {
  exercise: string;
  weight_lb: number;
  reps: number | null;
  local_date: string;
}

/**
 * Heaviest COMPLETED set ever, per exercise.
 *
 * Deliberately separate from `getSetsForExercise`, which windows to the last
 * few sessions — a lifetime best is exactly the thing a recent window cannot
 * see. `completed = 1` matters: a failed attempt at 235 is not a 235.
 * Ties on load break toward more reps, matching `shapeSession`'s top_set rule
 * so "best" means the same thing in both places.
 */
export async function getBestSets(ctx: Ctx, exercises: string[]): Promise<BestSet[]> {
  if (exercises.length === 0) return [];
  const holes = exercises.map(() => '?').join(',');
  const res = await ctx.db
    .prepare(
      `SELECT s.exercise, s.weight_lb, s.reps, w.local_date
         FROM sets s JOIN workouts w ON w.id = s.workout_id
        WHERE w.user_id = ? AND w.deleted_at IS NULL
          AND s.completed = 1 AND s.weight_lb IS NOT NULL
          AND s.exercise IN (${holes})
        ORDER BY s.exercise ASC, s.weight_lb DESC, s.reps DESC, w.local_date ASC`,
    )
    .bind(ctx.userId, ...exercises)
    .all<BestSet>();

  // First row per exercise wins, given the ORDER BY. Earliest date on a tie,
  // so a best is dated to when it was FIRST hit rather than most recently
  // repeated — "first time I've hit 225" is the sentence being supported.
  const best = new Map<string, BestSet>();
  for (const r of res.results ?? []) {
    if (!best.has(r.exercise)) best.set(r.exercise, r);
  }
  return [...best.values()];
}

// ---------- prescriptions ----------

export interface NewPrescribedSet {
  ordinal: number;
  exercise: string;
  exercise_raw: string | null;
  block: string | null;
  sets: number | null;
  rep_low: number | null;
  rep_high: number | null;
  target_weight_lb: number | null;
  notes: string | null;
}

export interface PrescribedSetRow extends NewPrescribedSet {
  id: string;
}

export interface PrescriptionRow {
  id: string;
  local_date: string;
  label: string | null;
  notes: string | null;
  status: string;
  workout_id: string | null;
  created_at: string;
}

export interface PrescriptionDetail extends PrescriptionRow {
  sets: PrescribedSetRow[];
}

/**
 * Write a prescription and its targets in one batch, marking any existing
 * prescription for the same date `replaced` first.
 *
 * Replace rather than accumulate: a model that writes a second prescription for
 * Tuesday means Tuesday changed, not that Tuesday now has two sessions. The old
 * row survives with status 'replaced' so the change is inspectable.
 */
export async function insertPrescription(
  ctx: Ctx,
  p: { local_date: string; label: string | null; notes: string | null },
  sets: NewPrescribedSet[],
): Promise<{ id: string; replaced: number }> {
  const id = crypto.randomUUID();
  const now = ctx.now.toISOString();

  const replacedRes = await ctx.db
    .prepare(
      `UPDATE prescriptions SET status = 'replaced'
        WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL AND status = 'planned'`,
    )
    .bind(ctx.userId, p.local_date)
    .run();

  const stmts = [
    ctx.db
      .prepare(
        `INSERT INTO prescriptions (id, user_id, local_date, label, notes, status, created_at)
         VALUES (?,?,?,?,?, 'planned', ?)`,
      )
      .bind(id, ctx.userId, p.local_date, p.label, p.notes, now),
    ...sets.map((s) =>
      ctx.db
        .prepare(
          `INSERT INTO prescribed_sets (id, prescription_id, ordinal, exercise, exercise_raw,
             block, sets, rep_low, rep_high, target_weight_lb, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(), id, s.ordinal, s.exercise, s.exercise_raw,
          s.block, s.sets, s.rep_low, s.rep_high, s.target_weight_lb, s.notes,
        ),
    ),
  ];
  await ctx.db.batch(stmts);
  return { id, replaced: replacedRes.meta.changes ?? 0 };
}

const PRESC_COLS = 'id, local_date, label, notes, status, workout_id, created_at';

async function withSets(ctx: Ctx, row: PrescriptionRow): Promise<PrescriptionDetail> {
  const res = await ctx.db
    .prepare(
      `SELECT id, ordinal, exercise, exercise_raw, block, sets, rep_low, rep_high,
              target_weight_lb, notes
         FROM prescribed_sets WHERE prescription_id = ? ORDER BY ordinal ASC`,
    )
    .bind(row.id)
    .all<PrescribedSetRow>();
  return { ...row, sets: res.results ?? [] };
}

/** The live prescription for a date. `replaced` rows are never returned. */
export async function getPrescription(
  ctx: Ctx,
  date: string,
): Promise<PrescriptionDetail | null> {
  const row = await ctx.db
    .prepare(
      `SELECT ${PRESC_COLS} FROM prescriptions
        WHERE user_id = ? AND local_date = ? AND deleted_at IS NULL AND status != 'replaced'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(ctx.userId, date)
    .first<PrescriptionRow>();
  return row ? withSets(ctx, row) : null;
}

export async function getPrescriptionById(
  ctx: Ctx,
  id: string,
): Promise<PrescriptionDetail | null> {
  const row = await ctx.db
    .prepare(`SELECT ${PRESC_COLS} FROM prescriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(id, ctx.userId)
    .first<PrescriptionRow>();
  return row ? withSets(ctx, row) : null;
}

export async function setPrescriptionStatus(
  ctx: Ctx,
  id: string,
  status: 'planned' | 'completed' | 'skipped',
  workoutId: string | null = null,
): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE prescriptions SET status = ?, workout_id = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(status, workoutId, id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function softDeletePrescription(ctx: Ctx, id: string): Promise<boolean> {
  const res = await ctx.db
    .prepare(
      `UPDATE prescriptions SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctx.now.toISOString(), id, ctx.userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
