-- Phase 2.5 — link a logged meal back to the recipe it came from.
--
-- Nullable and additive: every existing row stays valid, and a meal logged
-- from a description simply has no slug. The catalog itself is bundled into
-- the Worker rather than stored here — recipes change at the speed of commits,
-- so a table would only add a sync step that can drift.
-- Also introduces a new `source` value: 'recipe'. The column is plain TEXT with
-- no CHECK, so this needs no schema change — but the set is now
-- estimate | corrected | barcode | import | recipe. Only the server sets
-- 'recipe', and only when a recipe_slug resolved.
ALTER TABLE meals ADD COLUMN recipe_slug TEXT;

-- "How often do I actually cook the galbi jjim?" is a real question, and
-- without this it is a full scan of the meal log.
CREATE INDEX idx_meals_recipe ON meals(user_id, recipe_slug) WHERE recipe_slug IS NOT NULL;
