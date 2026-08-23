-- Macromiser initial schema. See ARCHITECTURE.md §4.
-- Three decisions worth defending, encoded here:
--   alcohol_g is its own column (never folded into carbs)
--   source + confidence on every meal (estimated != corrected)
--   local_date denormalized, computed in the user's tz on write

-- ---------- identity ----------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  tz            TEXT NOT NULL DEFAULT 'America/New_York',
  units         TEXT NOT NULL DEFAULT 'imperial',
  created_at    TEXT NOT NULL
);

-- ---------- nutrition ----------
CREATE TABLE meals (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  logged_at     TEXT NOT NULL,            -- ISO8601 UTC
  local_date    TEXT NOT NULL,            -- YYYY-MM-DD in user tz; the grouping key
  meal_type     TEXT,                     -- breakfast|lunch|dinner|snack
  description   TEXT NOT NULL,            -- verbatim user text
  kcal          REAL NOT NULL,
  protein_g     REAL NOT NULL,
  fat_g         REAL NOT NULL,
  carb_g        REAL NOT NULL,
  fiber_g       REAL,
  alcohol_g     REAL NOT NULL DEFAULT 0,  -- pure ethanol; NOT folded into carbs
  confidence    TEXT NOT NULL,            -- high|medium|low
  source        TEXT NOT NULL,            -- estimate|corrected|barcode|import
  deleted_at    TEXT,                     -- soft delete
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_meals_user_date ON meals(user_id, local_date);

-- ---------- training ----------
CREATE TABLE workouts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  local_date    TEXT NOT NULL,
  session_label TEXT,                     -- 'Day A', 'Pull', free text
  notes         TEXT,
  deleted_at    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_workouts_user_date ON workouts(user_id, local_date);

CREATE TABLE sets (
  id            TEXT PRIMARY KEY,
  workout_id    TEXT NOT NULL REFERENCES workouts(id),
  exercise      TEXT NOT NULL,            -- normalized slug: 'back_squat'
  exercise_raw  TEXT,                     -- as the user said it
  set_no        INTEGER NOT NULL,
  reps          INTEGER,
  weight_lb     REAL,
  rpe           REAL,
  completed     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sets_exercise ON sets(exercise);
CREATE INDEX idx_sets_workout ON sets(workout_id);

-- ---------- body + goals ----------
CREATE TABLE bodyweight (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  local_date    TEXT NOT NULL,
  weight_lb     REAL,
  waist_in      REAL,
  UNIQUE(user_id, local_date)
);

CREATE TABLE goals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  effective_from   TEXT NOT NULL,          -- goals are versioned, never overwritten
  kcal             REAL,
  protein_g        REAL,
  fat_g            REAL,
  carb_g           REAL,
  target_weight_lb REAL,
  weekly_sessions  INTEGER
);
CREATE INDEX idx_goals_user_from ON goals(user_id, effective_from);

-- ---------- the correction flywheel ----------
CREATE TABLE portion_memory (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  phrase        TEXT NOT NULL,            -- 'my usual chicken portion'
  kcal          REAL, protein_g REAL, fat_g REAL, carb_g REAL,
  times_used    INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  UNIQUE(user_id, phrase)
);
