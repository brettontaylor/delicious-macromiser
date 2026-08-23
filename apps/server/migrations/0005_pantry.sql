-- Two lists, deliberately NOT an inventory.
--
-- A quantity-tracking pantry is the most reliably abandoned feature in cooking
-- apps: you use half an onion and do not tell the app, and within a week the
-- state is wrong. Wrong inventory is worse than none, because it suggests food
-- you do not have. Receipt scanning does not fix it either — it knows what you
-- bought, never what you ate, so the error only accumulates.
--
-- So: no quantities, no decrementing. 'staple' is what you always have and
-- changes a few times a year. 'fresh' is a short list you can retype in ten
-- seconds. Deliberately lossy, and enough to answer "what can I make tonight".
CREATE TABLE pantry (
  user_id  TEXT NOT NULL REFERENCES users(id),
  item     TEXT NOT NULL,   -- lowercased on write; matching is substring-based
  kind     TEXT NOT NULL,   -- staple | fresh
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item)
);
