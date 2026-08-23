-- US-1 Phase 1 — the capture queue.
--
-- A capture is something the user recorded in the app that is not yet a meal:
-- a typed note now, a photo in Phase 2. It becomes a meal when a model reads it
-- and calls log_meal with the capture_id.
--
-- The queue exists because the app deliberately has no LLM. The user's model —
-- the one they already pay for, reached through the connector — does the
-- analysis. The app only captures.
CREATE TABLE captures (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,            -- ISO8601 UTC
  local_date  TEXT NOT NULL,            -- the day it belongs to, computed on write
  kind        TEXT NOT NULL,            -- note | photo
  note        TEXT,                     -- what the user typed, verbatim
  object_key  TEXT,                     -- R2 key; null for a note (Phase 2)
  mime_type   TEXT,
  bytes       INTEGER,
  state       TEXT NOT NULL DEFAULT 'pending',  -- pending | logged | unusable
  reason      TEXT,                     -- why it was unusable, in the model's words
  -- Deliberately NOT a foreign key. meals.capture_id already references this
  -- table, and making this reference meals back creates a cycle SQLite cannot
  -- resolve: neither table can be deleted first, so DELETE fails on both with
  -- FOREIGN KEY constraint failed. That would break the restore path, which is
  -- the only undo this project has. The meal->capture direction is the one that
  -- carries provenance; this way round is convenience and does not need
  -- enforcing.
  meal_id     TEXT,
  resolved_at TEXT
);

-- get_pending_captures runs at the start of many conversations. A partial index
-- keeps that a lookup rather than a scan, and stays small because resolved rows
-- drop out of it.
CREATE INDEX idx_captures_pending ON captures(user_id, created_at)
  WHERE state = 'pending';

-- Links a meal back to the evidence it came from.
ALTER TABLE meals ADD COLUMN capture_id TEXT REFERENCES captures(id);
