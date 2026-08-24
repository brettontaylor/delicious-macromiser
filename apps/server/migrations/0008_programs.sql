-- Programs — the standing block a prescription comes from.
--
-- Phase 1 (0007) made one dated session storable. This makes the thing behind
-- it storable: "two weeks, A/B/C, +5 lb upper / +10 lb lower". In the source
-- transcript that was a table with Wk 1 and Wk 2 columns and a written
-- progression rule the model itself called "the part people skip and the part
-- that works". None of it could be kept, so every session re-derived the whole
-- programme from scratch.
--
-- A program does not replace a prescription. It GENERATES one: the model reads
-- today's template, applies the rule against real history, and writes the
-- session down. Nothing here auto-writes — a plan the user never agreed to is
-- not a plan.
CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  name             TEXT NOT NULL,      -- 'Hinge + hypertrophy block'
  weeks            INTEGER,            -- NULL = open-ended

  -- The progression rule VERBATIM, in the user's and model's own words.
  -- Never parsed, never enforced by the server. The Skill reads it and applies
  -- it, because it is coaching and coaching changes weekly — the same reason
  -- training_plan.notes is free text rather than an enum.
  progression_rule TEXT,

  started_on       TEXT NOT NULL,      -- YYYY-MM-DD, user tz
  ends_on          TEXT,               -- derived from weeks at write; NULL = open
  status           TEXT NOT NULL,      -- active | completed | abandoned
  created_at       TEXT NOT NULL
);
-- One active program at a time is the normal case, and every read asks for it.
CREATE INDEX idx_programs_active ON programs(user_id, status);

-- One row per weekday the program touches.
--
-- Keyed by weekday, mirroring training_plan (0004) and for the reason that
-- migration already defends: people say "lower body on Tuesday", and a schedule
-- you cannot state in those words is a schedule you will not follow. A rotating
-- N-day cycle would be more general and less usable.
CREATE TABLE program_days (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id),
  weekday      INTEGER NOT NULL,       -- 0 = Sunday, matching Date#getDay
  day_key      TEXT,                   -- 'A' | 'B' | 'C' — how the user says it
  label        TEXT,                   -- 'Squat + vertical push + core'
  UNIQUE(program_id, weekday)
);

-- The template's exercises. Targets, never results.
CREATE TABLE program_exercises (
  id               TEXT PRIMARY KEY,
  program_day_id   TEXT NOT NULL REFERENCES program_days(id),
  ordinal          INTEGER NOT NULL,
  exercise         TEXT NOT NULL,      -- normalizeExercise() output
  exercise_raw     TEXT,
  block            TEXT,               -- 'A', 'C1', 'C2' — superset pairing
  sets             INTEGER,
  rep_low          INTEGER,
  rep_high         INTEGER,
  target_weight_lb REAL,

  -- NULL = applies every week. 0, 1, 2… = that week only, overriding the
  -- NULL row for the same exercise. This is how the transcript's "Wk 1: 175 /
  -- Wk 2: 185" is stored without duplicating the whole day per week.
  --
  -- The rule remains the source of truth: a pre-computed week-2 load does not
  -- survive a missed rep in week 1, and the Skill is expected to prefer the
  -- rule when reality diverges.
  week_offset      INTEGER,

  notes            TEXT
);
CREATE INDEX idx_progex_day ON program_exercises(program_day_id, ordinal);
