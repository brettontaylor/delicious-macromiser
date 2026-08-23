# Backfilling from an existing chat

A one-time procedure for seeding the log from a conversation where you already
tracked meals and lifts by hand. Not an import pipeline — the data is already in
that conversation's context, so the only thing needed is the connector plus a
disciplined prompt.

## Why it is phased

There is no `update_entry` or `delete_entry` tool. Both are deferred to Phase 3,
where they belong with the correction UI that gives them a purpose. Until then
**anything written can only be undone with `wrangler d1 execute`**. So the
procedure below inventories first, gets your approval, and writes last.

The other failure mode is date attribution. An assistant reading back through a
long conversation does not reliably know *when* past messages were sent — it
sees "I squatted 205 today" without knowing that "today" was three weeks ago.
Every entry therefore needs an explicit `YYYY-MM-DD`, and anything unresolved
gets asked about rather than guessed.

## Prerequisites

- The connector is added on claude.ai and the tools are visible in that chat
- `log_meal` supports `source: "import"` (shipped 2026-08-23), so reconstructed
  rows stay distinguishable from data captured live

## The prompt

Paste this into the conversation that holds the history:

```text
You have the macromiser connector in this conversation. I want to backfill it
with the training and nutrition data already in THIS chat's history. Work in
three phases and do not skip ahead.

PHASE 1 — INVENTORY. Make no tool calls in this phase.

Read back through this entire conversation and build a table of every entry you
can support with numbers I actually stated, or that you calculated for me at the
time:

  - Meals: date, description, kcal, protein_g, fat_g, carb_g, alcohol_g
  - Workouts: date, exercise, and each set's weight and reps
  - Bodyweight / waist: date, value
  - Targets: daily kcal and macro goals, goal weight, weekly session count

Rules:
  - Include an entry ONLY if the numbers appear in the conversation. Do not
    re-estimate from a description now, and do not fill gaps with plausible
    values. A missing day is fine. An invented one is not.
  - Give every entry an exact date as YYYY-MM-DD. If a date is only relative
    ("yesterday", "last Tuesday", "this morning") and you cannot resolve it with
    certainty, write UNRESOLVED instead of guessing.
  - Mark each row's confidence: "high" if the numbers were weighed or off a
    package, "low" if it was a restaurant meal or a vague portion.
  - Keep alcohol separate. Do not fold drink calories into carbs.

Show me the table, then stop.

PHASE 2 — I CORRECT IT. Wait for me. I will fix dates, drop rows, and resolve
anything marked UNRESOLVED.

PHASE 3 — WRITE. Only after I approve. One call per entry:
  - log_meal      with when="YYYY-MM-DD" and source="import"
  - log_workout   with when="YYYY-MM-DD" (all sets in one call, not one per set)
  - log_bodyweight with date="YYYY-MM-DD"
  - set_goals     for targets, dated from when they first applied

Then call get_history across the full range and show me what actually landed so
I can compare it to the approved table.

Note: there is no way to edit or delete an entry through these tools yet.
Anything you write is permanent until I fix it in the database by hand. That is
why Phase 1 writes nothing.
```

## After it runs

Spot-check that reconstructed rows are labelled, and that nothing landed on
today's date by accident:

```bash
cd apps/server
npx wrangler d1 execute macromiser-prod --remote --env prod --command \
  "SELECT local_date, source, confidence, count(*) n FROM meals GROUP BY 1,2,3 ORDER BY 1"
```

A pile of rows on today's date with `source='import'` means date attribution
failed and the inventory table was approved too quickly.

## If it goes wrong

Imported meals are identifiable, so they can be removed without touching
anything logged live:

```bash
npx wrangler d1 execute macromiser-prod --remote --env prod --command \
  "DELETE FROM meals WHERE source='import'"
```

Workouts have no `source` column, so delete those by date range instead. Bodyweight
upserts on `(user_id, local_date)`, so re-running a backfill corrects rather than
duplicates.
