-- Dev-only seed so `get_today` / `get_last_performance` return something
-- meaningful before you have logged anything. Apply to --local only.
INSERT OR IGNORE INTO users (id, email, tz, units, created_at)
VALUES ('owner', NULL, 'America/New_York', 'imperial', '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO goals (id, user_id, effective_from, kcal, protein_g, fat_g, carb_g, target_weight_lb, weekly_sessions)
VALUES ('goal-seed', 'owner', '2026-01-01', 2300, 170, 75, 235, 190, 3);
