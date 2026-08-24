# Macromiser tool reference

Per-tool semantics: what a null means, which fields mislead, how each write
behaves. Read a section when you are about to use a tool you have not used this
session.

This is separate from `SKILL.md` on purpose. That file is injected on every
trigger and holds routing (§0) and the six discipline rules (§1). The pantry-null
rule does not need to be in context when someone asks what to bench.

**`SKILL.md` §0 decides *which* tool to call. This file only says how each one
behaves once chosen.** Nothing here overrides that routing table.

---

## Nutrition

### `log_meal`

- Estimate the macros yourself; the server stores what you send and never
  re-estimates.
- `alcohol_g` is grams of **pure ethanol**, and its calories must not also
  appear in `carb_g`. The server derives alcohol kcal at 7 kcal/g.
- `capture_id` closes the app capture in the **same call**. Two calls would mean
  two approval prompts.
- `recipe_slug` + `servings` **replaces** kcal and macros — anything else you
  send is ignored, and the entry lands at high confidence because the portions
  were measured when it was cooked. Never use a slug for something merely
  *similar* to a recipe; that is an estimate and must be logged as one.
- **Not idempotent.** Never retry a call that may have partly succeeded.

### `correct_meal`

Partial — send only the fields that are wrong. The edit sets `source='corrected'`
and `confidence='high'`, because a human has now looked at the numbers, which is
different evidence.

When the macros actually move, the description becomes a **remembered portion**:
the next estimate of that phrase starts from the corrected figures. `get_briefing`
returns these as `known_portions`. Reuse them rather than re-estimating.

### `get_today` / totals

- Returns `logged_at` per meal, so the hour a meal landed is answerable.
- `totals.food_kcal` excludes alcohol; `totals.kcal` includes it.
- `remaining` is null-safe: fields are null when no goal is set, not zero.

### `pace`

On `get_today` and `get_briefing`. Today against the **same clock time** on past
days.

- `typical_protein_g: null` means fewer than three comparable days. Say nothing
  about pace; `reason` explains which case it is.
- Only meals logged **on the day they were eaten** count. A backfilled row
  carries the time it was *written*, so an import cannot teach pace. This is why
  a long history can still yield `days_compared: 0`.
- A day that was logged but empty by this hour counts as a real zero — dropping
  it would flatter today.
- `best_yet` is strict. Matching the best is not beating it.

### `list_recipes` / pantry

- `have` / `missing` are **null**, not empty arrays, when no pantry is set up.
  Null means unknown, not bare.
- Weigh `missing` yourself. A missing herb is not a missing protein, and telling
  someone they cannot cook because they lack parsley is worse than useless.
- The pantry is two lists, not an inventory. Do not offer to track quantities;
  say what it is for instead.
- A serving eaten without a component (the rice, the polenta) is still loggable:
  `list_recipes` returns a per-component breakdown, so subtract that component
  and log the remainder as an estimate rather than pretending it was the full
  plate.

### `import_days`

One call for many days, not a loop over `log_meal` — every call is a separate
approval prompt. **Not idempotent**: calling twice writes everything twice.
Confirm the whole list with the user first.

---

## Training

### `get_session`

Returns the written plan **and** `last` / `best_ever` per lift in one round trip.

- `no_prescription: true` — nothing is written down for that date. This is **not**
  a rest day; check `get_training_plan` for what the day is FOR.
- `from_program` appears when a block covers that day but nothing has been
  written yet. `from_program.suggested` is the template with history beside each
  lift. **It is a suggestion, not a plan** — set the loads, show the user, then
  `prescribe_session` with `from_program: true`.
- `from_program.expired: true` — the date is past the block's end. Say the block
  is over and offer the next one; do not serve its last week again.
- `reconciliation` appears once a workout is linked: planned against done, as
  arithmetic. Whether a miss matters is your judgement.

### `prescribe_session`

- Get every load from `get_session` or `get_last_performance` first.
- Do not prescribe speculatively. Not every mention of squats is a plan.
- Prescribing again for the same date **replaces** a planned session and keeps
  the superseded row. That is right when the plan changed; it is not how you log
  two sessions in a day. A **completed** prescription is left alone.
- `from_program: true` materializes the block's template instead of re-sending
  the exercise list, and takes the day's label with it.

### `log_workout`

- One call per session, with every set.
- `prescription_id` marks the plan completed and returns `reconciliation` in the
  same call. Omit it and any prescription for that date links automatically.
- `personal_records` is non-empty when a set beat everything before it. Mention
  it — it is the one moment in this loop worth marking.
  - `first_ever: true` means it is simply the first time that lift has been
    logged with a load. **That is not a PR.** Do not announce it as one.
- `incomplete_sets` non-empty means the write succeeded with gaps. Name them.
- The exercise name is normalized, so "squats", "back squat" and "RDL" resolve
  to one history. Use the name the user actually said.

### `correct_workout`

Sets are addressed by `set_no` within the session — how people actually refer to
them ("the third set was only 3 reps"). `remove: true` for a set that never
happened; `null` for a value genuinely unknown rather than a guessed one.
`workout_id` comes from `get_last_performance` or `get_history`.

### `get_last_performance`

Facts only: `top_set`, `all_sets_completed`, `max_rpe`, `days_ago`,
`sessions_logged`, `enough_history_to_progress`, `movement_pattern`,
`best_ever`, and `workout_id`.

`best_ever` is the heaviest **completed** set ever, dated to when it was *first*
hit. A failed attempt at 235 is not a 235.

### `set_program` / `get_program`

- `progression_rule` is stored **verbatim and never parsed**. It is the user's
  own agreed rule — see `SKILL.md` §2 for precedence.
- Per-week loads use `week` on the exercise (1-based). Send a lift twice — once
  plain, once with `week: 2` — rather than duplicating the day.
- Setting a new block retires the active one. `end_program` distinguishes
  *completed* from *abandoned*; the distinction is worth recording honestly.
- `no_program_set: true` — none has been set up. Offer to build one rather than
  implying nothing is planned.
- **The block never writes a session by itself.**

### `get_training_plan`

The shape of a week — which weekdays are lift, active or rest, plus the user's
standing rules. Facts, not an instruction: the plan says Tuesday is lower body;
you decide whether Tuesday is a good idea.

- `no_plan_set: true` means they have never set a split up. Do not let it read
  as "today is a rest day".
- A day's `notes` are the user's **own** standing rules. Repeat them back in
  their words rather than substituting generic advice.

---

## Body and context

### `log_bodyweight`

Either field may be sent alone — sending only a waist measurement will not erase
that day's weight. Upserts on the date, so a re-weigh the same day replaces
rather than duplicates.

### `log_event` / `get_events`

Annotations that change how a reading should be read.

- `affects` — `weight | training | nutrition | all | none`. What the event
  actually clouds.
- `ends_on` and `caveat_until` are **different dates**. Creatine taken daily
  never ends (`ends_on` null) but stops moving the scale after about three
  weeks (`caveat_until`). Collapsing them loses one.
- `clouded_readings` lists what currently has an open caveat window;
  `caveat_days_left` counts it down.
- **Not a diary.** An event earns a row only if it changes the reading of a
  number already in the log. Anything else is a note on the meal or workout it
  belongs to.
- Only weight-affecting events are drawn on the trend chart — an injury does not
  explain the scale.

### `get_pending_captures` / `resolve_capture`

- A capture may be a note, a **photo**, or both. Photos come back as images —
  look at them.
- The notes are already inline in `get_briefing`. Call this tool only when you
  need to see an image.
- Estimate, then `log_meal` with `capture_id` — that logs the meal and closes
  the capture in one call.
- Too vague to estimate → `resolve_capture` with `state: "unusable"` and a
  reason. See `SKILL.md` §1.4.

### `get_week_summary`

- Averages are computed over days that **have data**; `days_with_data` comes
  back alongside so a sparse week can be called sparse.
- `events_in_window` and `clouded_readings` say when the window itself is not
  readable.
- `weight_trend` compares the first half of the window against the second.

---

## Cross-cutting

| Behaviour | Which tools |
|---|---|
| **Not idempotent** — never retry a partial call | `log_meal`, `log_workout`, `import_days` |
| **Upserts** — safe to repeat | `log_bodyweight`, `set_pantry`, `set_training_plan` |
| **Replaces on repeat** | `prescribe_session` (same date, planned), `set_program` |
| **Soft delete, recoverable** | `delete_meal`, `delete_workout`, `delete_event`, `delete_prescription` |
| **Returns `NOT SAVED` / `NOT CHANGED` on refusal** | every write. See `SKILL.md` §1.5 |

Identity is resolved server-side from the connector URL. A `user_id` in tool
arguments is ignored; never try to supply one.
