-- The weekly plan — what the user INTENDS to do, as opposed to what they did.
--
-- Everything in this database until now has been a record of the past. The app
-- could answer "what did I lift" and had nothing to say about "what am I
-- supposed to do today", which is the question someone actually opens it with.
--
-- One row per weekday. Not a rotating cycle: people describe their training as
-- "lower body on Tuesday", and a schedule you cannot state in those words is a
-- schedule you will not follow.
CREATE TABLE training_plan (
  user_id   TEXT NOT NULL REFERENCES users(id),
  weekday   INTEGER NOT NULL,   -- 0 = Sunday .. 6 = Saturday, matching Date#getDay
  kind      TEXT NOT NULL,      -- lift | active | rest
  label     TEXT,               -- 'Lower body', 'Pull', 'Long walk'
  notes     TEXT,               -- 'walk 10k steps, no phone after 8, no alcohol'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, weekday)
);
