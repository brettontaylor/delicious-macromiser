-- Events — dated annotations that change how the DATA should be read.
--
-- This exists because a real coaching conversation asked for it and the server
-- could not accept the write. On starting creatine: "note it in macromiser so
-- future-you knows to disregard the first three weeks of scale data." Creatine
-- pulls 1-2 kg of water into muscle, so the 7-day average climbs for three
-- weeks while the diet is working perfectly. Without a marker, the trend chart
-- shipped in Phase 3 shows a rising line during a deficit and says nothing.
-- That is the moment someone quits.
--
-- Not a diary and not a symptom log. An event earns a row only if it changes
-- how an existing number should be interpreted — travel, injury, a deload, a
-- supplement, a work crunch. If it does not caveat a reading, it is a note and
-- belongs in the meal or workout it describes.
CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),

  -- Controlled vocabulary, following training_plan.kind and pantry.kind. The
  -- view styles on it and the model gets a stable set to reach for; `other`
  -- is the escape hatch rather than a reason to leave it free text.
  kind         TEXT NOT NULL,      -- supplement|travel|injury|illness|deload|life|other
  label        TEXT NOT NULL,      -- 'Started creatine, 5 g/day' — the user's own words

  -- THREE dates, three distinct jobs. Collapsing any two of them loses
  -- information the chart needs:
  --   starts_on    when the thing began
  --   ends_on      when it stopped. NULL means ongoing — which is the normal
  --                state for a supplement, and NOT the same as a point event
  --   caveat_until how long it distorts the readings. Creatine is ongoing
  --                (ends_on NULL) but only clouds the scale for ~3 weeks, so
  --                ends_on cannot carry this. NULL means no distortion window
  starts_on    TEXT NOT NULL,      -- YYYY-MM-DD, user tz
  ends_on      TEXT,
  caveat_until TEXT,

  -- Which readings this distorts, so the model knows what to discount and what
  -- is still trustworthy. The transcript's advice was precisely this shape:
  -- "track waist instead during that window" — weight is clouded, waist is not.
  affects      TEXT NOT NULL DEFAULT 'none',  -- weight|training|nutrition|all|none

  notes        TEXT,
  deleted_at   TEXT,               -- soft delete, matching meals and workouts
  created_at   TEXT NOT NULL
);

-- Every read is "events overlapping this date range", so the range bound is
-- what wants indexing. Partial on deleted_at because a soft-deleted event must
-- never reach the chart.
CREATE INDEX idx_events_user_range ON events(user_id, starts_on, ends_on)
  WHERE deleted_at IS NULL;
