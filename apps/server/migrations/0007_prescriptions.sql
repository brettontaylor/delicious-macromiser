-- Prescriptions — a dated session with real target loads, written down before
-- it is trained.
--
-- Everything else in this database is a record of the past, with one exception:
-- training_plan (0004), which records the SHAPE of a week — "Tuesday is lower
-- body". It cannot record the CONTENT of a session — "Tuesday is back squat
-- 4x6 at 185".
--
-- That gap is why the best artifact of a real coaching conversation evaporated.
-- The model wrote a warmup, seven exercises with sets, reps, loads and superset
-- pairings, and closed with "Tuesday or Wednesday is Day A — squats at 215."
-- None of it survived the context window, and next Tuesday it gets re-derived
-- from scratch, differently.
--
-- DELIBERATELY SEPARATE FROM `workouts`. Intent and fact must never share a
-- table. A planned 185 that becomes the base for the next progression is a
-- lifter programmed off a session they never did, and `get_last_performance`
-- drives every load recommendation in the product. Keeping prescribed sets out
-- of `sets` means `getSetsForExercise` cannot see them by construction, rather
-- than by a WHERE clause someone can forget.
CREATE TABLE prescriptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  local_date   TEXT NOT NULL,          -- YYYY-MM-DD in the user's tz
  label        TEXT,                   -- 'Day A', 'Hinge + pull'
  notes        TEXT,                   -- warmup, ordering, standing reminders

  -- planned   : written, not yet trained
  -- completed : a workout was logged that day and linked back here
  -- skipped   : the day passed and the user said it did not happen
  -- replaced  : superseded by a later prescription for the same date
  status       TEXT NOT NULL DEFAULT 'planned',

  -- A PLAIN COLUMN, not a foreign key. GOTCHAS records what the mutual
  -- captures.meal_id <-> meals.capture_id keys did: neither table could be
  -- deleted, and restore.mjs --replace broke, which is this project's only
  -- undo. Provenance points one way — the prescription knows which workout
  -- fulfilled it — and the other side stays a plain column.
  workout_id   TEXT,

  deleted_at   TEXT,                   -- soft delete, matching meals and workouts
  created_at   TEXT NOT NULL
);

-- Every read is "the prescription for this date", and a soft-deleted one must
-- never reach the view.
CREATE INDEX idx_presc_date ON prescriptions(user_id, local_date)
  WHERE deleted_at IS NULL;

-- The targets. Shaped like `sets` on purpose so the two are comparable when
-- reconciliation lands, but stored apart so they can never be confused for it.
CREATE TABLE prescribed_sets (
  id               TEXT PRIMARY KEY,
  prescription_id  TEXT NOT NULL REFERENCES prescriptions(id),
  ordinal          INTEGER NOT NULL,   -- execution order, 1-based
  exercise         TEXT NOT NULL,      -- normalizeExercise() output, so it can
                                       -- match what gets logged later
  exercise_raw     TEXT,               -- as the model wrote it
  block            TEXT,               -- 'A', 'B', 'C1', 'C2' — superset pairing
  sets             INTEGER,
  rep_low          INTEGER,
  rep_high         INTEGER,            -- equal to rep_low for a fixed target
  target_weight_lb REAL,               -- NULL for bodyweight, or "start light"
  notes            TEXT
);
CREATE INDEX idx_prescsets ON prescribed_sets(prescription_id, ordinal);
