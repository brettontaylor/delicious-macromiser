# E1 — The prescribed session and the training block

**Date:** 2026-08-24 · **Status:** PLANNED — not started
**Triggered by:** `Claude-Chat__core-and-belly-fat-progress-plateau__8.15.2026.txt`,
in which the model produced a complete two-week programme and the system had
nowhere to put it. Stories S-5, S-6, S-7, S-8, S-18, S-19, S-22, S-24, S-31, M-2.
**Related:** [user-stories.md](user-stories.md) · [UI-MAP.md](../UI-MAP.md) ·
[PRODUCT.md](../PRODUCT.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) ·
[ROADMAP.md](../ROADMAP.md)

---

## 1. Executive summary

Everything in this database is a record of the past, with one exception —
`training_plan` (`apps/server/migrations/0004_training_plan.sql`), which records
the *shape* of a week: Tuesday is lower body. It cannot record the *content* of a
session: Tuesday is back squat 4×6 at 185.

That gap is why the transcript's best artifact evaporated. The model wrote a
warmup, seven exercises with sets, reps, loads and superset pairings, a finisher,
and a written progression rule — then closed with "Tuesday or Wednesday is Day A
— squats at 215." None of it is anywhere. Next Tuesday the model re-derives it
from scratch, differently, and the user re-reads a plan they already agreed to.

**The most important design finding: this needs two entities, not one, and
conflating them would be a correctness bug.** A **program** is a standing block
("two weeks, A/B/C, +5 upper / +10 lower"). A **prescription** is one dated
session with concrete target loads. Programs generate prescriptions;
prescriptions are compared against logged workouts. That comparison — intent
versus actual — is the thing no competing tool has, and it is what finally makes
"three sessions a week, non-negotiable" a measurable claim rather than a wish.

The second finding is a boundary trap worth naming before anyone writes code.
A tool called `get_session` that *generates* a session would put coaching in the
server and violate [PRODUCT.md](../PRODUCT.md) §2. The server must only ever
**store the model's prescription and hand it back**, alongside the facts
(`get_last_performance`) the model needs to write the next one. Nothing in this
plan generates a workout.

---

## 2. Current-build map

Verified by reading the files, not from memory.

| Concern | Owner today | Note |
|---|---|---|
| The week's shape | `migrations/0004_training_plan.sql` — `(user_id, weekday)` PK, `kind`/`label`/`notes` | Weekday-keyed deliberately. The migration comment defends it: *"a schedule you cannot state in those words is a schedule you will not follow."* **This plan mirrors that key.** |
| Reading the plan | `domain/plan.ts:62 planView()`, `:100 whenPhrase()` | Pure, 10 unit tests. Handles wrap-around weeks and refuses to invent a rest day. |
| Plan tools | `mcp/tools/training_plan.ts` → `set_training_plan`, `get_training_plan` (`tools/index.ts:460-496`) | `set_training_plan` upserts a day at a time. Good precedent for partial writes. |
| Lift history | `db/queries.ts:149 getSetsForExercise()` → `domain/progression.ts:95 buildHistory()` → `tools/get_last_performance.ts` | Returns `top_set`, `all_sets_completed`, `max_rpe`, `days_ago`, `sessions_logged`, `workout_id`. **Already returns exactly the facts a progression rule needs** — see the module header, which explicitly says the rule lives in the Skill. |
| Movement patterns | `domain/exercise.ts:78 movementPattern()` | Exists, is tested, and **is not surfaced by any tool response.** S-8 and S-24 are nearly free once it is. |
| Exercise naming | `domain/exercise.ts:64 normalizeExercise()`, `:55 slugify()` | The prescription write path must use this, or "RDL" and "romanian deadlift" will never match. |
| Session writes | `db/queries.ts:109 insertWorkout()`, `tools/log_workout.ts`, shared validation in `tools/sets.ts` | `tools/sets.ts` is the extract-when-two-callers precedent. Prescriptions will be the second caller of set-shaped validation. |
| Orientation | `tools/get_briefing.ts` — one parallel round | §0 of `skill/SKILL.md` mandates it first. Anything a session needs must land here or it will not be read. |
| The view | `app/page.ts:196-227` renders the plan strip above the gauge | Exactly where the prescribed session belongs. [UI-MAP.md](../UI-MAP.md) §2 draws it. |
| Undo | `correct_meal`/`delete_meal`, `correct_workout`/`delete_workout` | The precedent. Every writable entity here needs its own answer. |

**Verified:** all of the above by reading the files.
**Assumed:** that `wrangler d1 migrations apply` is the only path to prod schema
changes and that migration numbering continues at `0006`.

---

## 3. User stories

### End user

| id | Story | Today | Gap |
|---|---|---|---|
| **E1.1** | "I'm going to the gym — what am I doing?" and gets the actual session, with loads, before leaving the house. | `get_training_plan` returns "Lower body". | The session itself. |
| **E1.2** | Agrees to a two-week block once and stops re-litigating it every session. | Nothing. | The program. |
| **E1.3** | Opens the app in the gym and reads today's lifts one-handed, without a chat. | `app/page.ts` shows the label only. | The session on the homepage. |
| **E1.4** | Logs sets as they happen, between rests, rather than reciting the session afterwards. | `log_workout` is one-call-per-session; a second call the same day silently creates a **second workout row**. | Append. |
| **E1.5** | Is told honestly whether they did what they said they would. | `get_week_summary` counts sessions. Nothing compares plan to actual. | Adherence. |
| **E1.6** | "The rack is taken — what instead?" and gets a substitute in the same movement pattern, chosen against their own history. | `movementPattern()` exists, unexposed. | Surface it. |
| **E1.7** | Takes a prescription back when it was wrong or the day changed. | n/a | Undo. |

### The model

| id | Story | Today | Gap |
|---|---|---|---|
| **E1.M1** | Knows what it prescribed last time, so this session continues rather than restarts. | Nothing. | `get_session`. |
| **E1.M2** | Writes the session down at the moment it proposes it, in one call, without a second approval prompt. | Nothing. | `prescribe_session`. |
| **E1.M3** | Never confuses a prescription with a log. A planned 185 must never read as a lifted 185. | n/a — the trap does not exist yet because the table does not. | Enforced at the query boundary: `getSetsForExercise` must never see a prescription row. |
| **E1.M4** | Gets the prescription **and** the relevant history in one round trip, not one call per lift. | `get_last_performance` takes an array — good. | `get_session` must return both, or it re-creates the four-call latency problem `get_briefing` was built to solve. |
| **E1.M5** | Is stopped from over-writing: not every mention of squats is a prescription. | n/a | Tool description must say so explicitly, in the style of `resolve_capture`'s *"Never invent numbers to clear the queue."* |

### Operator

| id | Story | Risk if missed |
|---|---|---|
| **E1.O1** | A prescription that was never followed does not quietly become training history. | Corrupts `get_last_performance`, which drives every future load. The highest-consequence failure in this plan. |
| **E1.O2** | The prescription table cannot grow without bound. | One row per session per exercise is small; a model writing on every mention is not. Cap and dedupe by date. |
| **E1.O3** | Backup covers the new tables. | `backup.ts` exports the whole D1 — verify, do not assume. |

### System

| id | Story | Failure mode |
|---|---|---|
| **E1.S1** | Nothing runs unattended for this feature. | None — deliberately. A cron that "rolls the program forward" would be a scheduler this project does not need. Prescriptions are written by the model, on demand. |
| **E1.S2** | An abandoned program does not keep prescribing. | `programs.status` and `ends_on`; `get_session` returns nothing rather than a stale week-9 of a two-week block. |

---

## 4. Technical design

### 4.1 Migration — `0006_training_block.sql`

Additive, all nullable where it can be. Three tables.

```sql
-- A standing block. "Two weeks, A/B/C, +5 upper / +10 lower."
CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  name             TEXT NOT NULL,          -- 'Hinge + hypertrophy block'
  weeks            INTEGER,                -- null = open-ended
  -- The progression rule VERBATIM, in the user's and model's own words. Not
  -- parsed, not enforced by the server. The Skill reads it and applies it.
  -- The transcript called this "the part people skip and the part that works".
  progression_rule TEXT,
  started_on       TEXT NOT NULL,          -- YYYY-MM-DD, user tz
  ends_on          TEXT,                   -- derived at write; null = open-ended
  status           TEXT NOT NULL,          -- active | completed | abandoned
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_programs_active ON programs(user_id, status);

-- One row per weekday the program touches. Mirrors training_plan's key on
-- purpose: same reason, same words the user uses.
CREATE TABLE program_days (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id),
  weekday      INTEGER NOT NULL,           -- 0 = Sunday, matching Date#getDay
  day_key      TEXT,                       -- 'A' | 'B' | 'C' — how the user says it
  label        TEXT,                       -- 'Squat + vertical push + core'
  UNIQUE(program_id, weekday)
);

-- The template's exercises. Targets, not results.
CREATE TABLE program_exercises (
  id              TEXT PRIMARY KEY,
  program_day_id  TEXT NOT NULL REFERENCES program_days(id),
  ordinal         INTEGER NOT NULL,        -- display and execution order
  exercise        TEXT NOT NULL,           -- normalizeExercise() output
  exercise_raw    TEXT,                    -- as written
  block           TEXT,                    -- 'A','B','C1','C2' — supersets, from the transcript
  sets            INTEGER,
  rep_low         INTEGER,
  rep_high        INTEGER,                 -- = rep_low for a fixed target
  target_weight_lb REAL,                   -- null for bodyweight or "start light"
  week_offset     INTEGER,                 -- null = every week; 0,1,… = that week only
  notes           TEXT
);
CREATE INDEX idx_progex_day ON program_exercises(program_day_id, ordinal);
```

```sql
-- A DATED session with concrete targets. Written when the model programs a day.
-- Deliberately separate from `workouts`: intent and fact must never be one table.
CREATE TABLE prescriptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  local_date   TEXT NOT NULL,
  program_id   TEXT REFERENCES programs(id),   -- null for a one-off session
  label        TEXT,                            -- 'Day A', 'Hinge + pull'
  notes        TEXT,
  -- planned  : written, not yet trained
  -- completed: a workout was logged that day and reconciled against this
  -- skipped  : the day passed, nothing logged, the user said so
  -- replaced : superseded by a later prescription for the same date
  status       TEXT NOT NULL DEFAULT 'planned',
  workout_id   TEXT,                            -- plain column, NOT a foreign key
  deleted_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_presc_date ON prescriptions(user_id, local_date)
  WHERE deleted_at IS NULL;

CREATE TABLE prescribed_sets (
  id               TEXT PRIMARY KEY,
  prescription_id  TEXT NOT NULL REFERENCES prescriptions(id),
  ordinal          INTEGER NOT NULL,
  exercise         TEXT NOT NULL,
  exercise_raw     TEXT,
  block            TEXT,
  sets             INTEGER,
  rep_low          INTEGER,
  rep_high         INTEGER,
  target_weight_lb REAL,
  notes            TEXT
);
CREATE INDEX idx_prescsets ON prescribed_sets(prescription_id, ordinal);
```

**`prescriptions.workout_id` is a plain column, not a foreign key — on purpose.**
[GOTCHAS.md](../GOTCHAS.md) records that `captures.meal_id` ↔ `meals.capture_id`
as mutual foreign keys made *neither* table deletable and broke
`restore.mjs --replace`, the project's only undo. Same shape here: `workouts`
would otherwise need a `prescription_id` back-reference. Provenance points one
way — the prescription knows which workout fulfilled it — and the other side is
a plain column.

### 4.2 Queries — `db/queries.ts`

One owner per access path, following the file's existing convention.

| Function | Purpose |
|---|---|
| `getActiveProgram(ctx)` | The one row with `status='active'` and `ends_on` unpassed, with days and exercises. |
| `insertProgram(ctx, p)` | Writes program + days + exercises in one `db.batch()`. |
| `setProgramStatus(ctx, id, status)` | Completion and abandonment. The undo. |
| `getPrescription(ctx, date)` | One dated prescription + its sets, `deleted_at IS NULL`. |
| `insertPrescription(ctx, p)` | Batch write. Marks any existing same-date prescription `replaced`. |
| `setPrescriptionStatus(ctx, id, status, workoutId?)` | Reconciliation. |
| `softDeletePrescription(ctx, id)` | Mirrors `softDeleteMeal` (`queries.ts:330`). |
| `getPrescriptionsInRange(ctx, start, end)` | Adherence, and the view. |

**`getSetsForExercise` (`queries.ts:149`) is not touched and must never be.** It
reads `sets JOIN workouts`. Prescribed sets live in a different table precisely
so that this stays true by construction rather than by a `WHERE` clause someone
can forget.

### 4.3 Domain — `src/domain/block.ts` (new, pure, unit-tested)

No Worker, no D1 — the rule from Step 3 of the design-plan skill.

| Function | Contract |
|---|---|
| `programDayFor(program, weekday)` | The template for a weekday, or null. |
| `weekOfProgram(program, date)` | 0-based week index, or null when the date is outside `started_on…ends_on`. Drives `week_offset` selection and "week 2 of 2". |
| `materialize(programDay, weekIndex)` | Template → prescribed sets, applying `week_offset` overrides. **Pure.** This is where "Wk 1: 175 / Wk 2: 185" resolves. |
| `reconcile(prescribed, logged)` | Per-exercise `{ prescribed, actual, met: boolean }` plus session-level `adherence_pct` and `unplanned[]`. Compares on the normalized `exercise` slug. **Arithmetic only — never a verdict.** |
| `patternCoverage(exercises)` | Movement patterns hit, via `movementPattern()`. Answers S-8 ("no hip hinge in the program at all"). |

### 4.4 Tool surface

Four new tools. The registry is deliberately small
(`tools/index.ts:1-8`), so each has to earn its place.

**`prescribe_session`** — write one dated session.

```
date?               YYYY-MM-DD. Omit for today. Backdating uses resolveWhen (tools/args.ts:100).
label?              'Day A', 'Hinge + pull'
exercises[]         { exercise, sets?, rep_low?, rep_high?, target_weight_lb?, block?, notes? }
notes?              Warmup, ordering, anything standing
from_program?       true to materialize today's template instead of passing exercises
```

Description must carry the prohibitions, in the register of
`resolve_capture`:

> Write down the session you just proposed, so it survives this conversation.
> Call this **after** you have proposed a session the user has agreed to — not
> every time a lift is mentioned, and never speculatively. **A prescription is
> intent, not a record. It never counts as a logged workout**; call `log_workout`
> for what actually happened. Get loads from `get_last_performance` first — never
> propose one from memory. Writing a second prescription for the same date
> replaces the first.

**`get_session`** — today's session and the facts needed to adjust it.

Returns, in **one** round trip: the prescription with its sets, `last` per
prescribed exercise (reusing `buildHistory`), the active program's
`progression_rule` **verbatim**, `week_of` / `weeks`, and `reconciliation` when
a workout exists for the date. Returns `no_prescription: true` distinctly from
`no_program: true` — the `no_plan_set` precedent in `get_training_plan`, where
"never set up" and "today is rest" read the same on screen and mean opposite
things.

It returns **no recommendation**. The next load is the Skill's call, made from
`last` and `progression_rule`.

**`set_program`** — define the block. Days and exercises in one call;
`progression_rule` stored verbatim and never parsed.

**`end_program`** — `completed` or `abandoned`. The undo for E1.7, alongside
`prescribe_session` replacing a date and a soft delete.

**Changes to existing tools**

| Tool | Change | Why |
|---|---|---|
| `get_briefing` | Add `session: { label, exercise_count, status }` and `program: { name, week_of, weeks }`. Compact — not the full session. | §0 of the Skill makes this the first call. A field that is not here does not get read. Keep it one parallel round. |
| `log_workout` | Accept `prescription_id`; on write, set that prescription `completed` and stamp `workout_id` — **in the same call**. | The `log_meal` + `capture_id` precedent: two calls would double the approval prompts. |
| `get_last_performance` | Add `movement_pattern` to the response — already computed in `buildHistory` (`progression.ts:44`). | S-24, one line. |

### 4.5 View

`app/page.ts`, above the gauge, in the slot [UI-MAP.md](../UI-MAP.md) §2 draws —
the plan strip's natural extension. Exercises, targets, and a `logged` chip when
reconciled. States: no program (render nothing), program but no prescription for
today (render the day's label only), rest day (render nothing).

New route `/app/<secret>/session` for the full session, readable one-handed in a
gym, and `/program` for the block. Read-only on both capabilities in Phase 1:
editing a prescription from the phone is a Phase 4 question, and the app's own
principle is that conversation is the entry interface.

### 4.6 Skill

`skill/SKILL.md` learns, or none of the above exists:

- §0 — `get_briefing` now carries `session`. If it is present, lead with it.
- §1 — before any training answer, `get_session`. Before any load,
  `get_last_performance`. **In that order, and never a load from memory.**
- New rule: after proposing a session the user accepts, call `prescribe_session`
  immediately — in the same turn, while the numbers are on screen.
- New rule: **a prescription is not a log.** Never report a prescribed lift as
  performed. If the day is done, call `log_workout` with `prescription_id`.
- New rule: when `reconcile` shows a miss, say so plainly and without
  editorialising. The transcript's tone — "you've been doing about a third of
  the required dose" — is the register: factual, not scolding.
- New rule: `progression_rule` is the user's own agreed rule. Apply it; do not
  substitute a better one silently.

---

## 5. Phasing

| Phase | Ships | Depends on | Risk | Verification |
|---|---|---|---|---|
| ~~1~~ **The prescription** ✅ **2026-08-24** | Shipped as `0007_prescriptions.sql` (not `0006` — events took that number). `prescribe_session`, `get_session`, `delete_prescription`, `log_workout(prescription_id)`, homepage block, Skill rules. Reconciliation came along with it rather than waiting for Phase 3, because linking the workout was the natural place for it. | none | **Structural** | Done: `npm run verify:session`, 50 assertions, including the negative one. |
| **2 — The block** | programs tables, `set_program`, `end_program`, `materialize()`, `week_of` | 1 | **Structural** | S-6: store the transcript's real two-week A/B/C block; assert week 1 gives 175 and week 2 gives 185. |
| **3 — Reconciliation** | `log_workout(prescription_id)`, `reconcile()`, adherence in `get_week_summary`, `logged` chip | 1 | **Mechanical** | S-19: prescribe, log a partial session, assert `adherence_pct` and `unplanned[]`. |
| **4 — Session append** | `log_workout` merges into the same day's workout instead of inserting a second row | 3 | **Risky** — changes a shipped write path | S-18: two calls, one date, assert exactly one `workouts` row. Back up first. |
| **5 — Patterns** | `movement_pattern` on `get_last_performance`, `patternCoverage()` in `get_session` | 1 | **Mechanical** | S-8, S-24: assert a hinge-free week reports the gap. |

**Phase 1 unblocks the most** — every later phase reads the prescription table,
and it is independently valuable on its own: the transcript's core failure is
fixed by Phase 1 alone.

**Phase 4 touches a shipped write path** and is the only phase requiring
`POST /backup/<MCP_PATH_SECRET>` first.

---

## 6. Conforming to what exists

| Convention | How this plan honours it |
|---|---|
| The server never coaches | Nothing generates a session. `prescribe_session` stores the model's output; `get_session` returns it plus facts. `progression_rule` is stored verbatim and never interpreted. |
| Evidence quality | `prescriptions` is intent; `workouts` is fact; separate tables, and `getSetsForExercise` cannot reach the former. `status` records which prescriptions were actually met. |
| Undo on every writable entity | `prescribe_session` replaces by date, soft delete on prescriptions, `end_program` on blocks. Stated, not implied. |
| Capability by secret | New routes read-only under both `APP_VIEW_SECRET` and `APP_EDIT_SECRET`. No new write path in the view. |
| One stylesheet | `shell()` + `PAGE_CSS` from `app/layout.ts`. No second sheet, no client JS. |
| Few, well-described tools | Four new. `get_session` bundles prescription + history + rule rather than shipping three thin tools, mirroring what `get_briefing` did for orientation. |
| Weekday keys, not cycles | `program_days.weekday`, matching `training_plan` and its stated reasoning. |
| Cost | D1 and the existing Worker. Nothing new to pay for. |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **A prescription is read as history.** The worst outcome in this plan: a planned 185 becomes the base for the next progression and the user is programmed off a lift they never did. | Separate tables; `getSetsForExercise` untouched; explicit Skill rule; a unit test asserting `get_last_performance` returns nothing after a prescription-only write. |
| The model prescribes on every mention of a lift, filling the table. | Tool description forbids speculative writes; same-date writes replace rather than accumulate; one prescription per date by index. |
| Exercise names drift between prescription and log — "RDL" vs "romanian deadlift" — so reconciliation silently reports 0%. | `normalizeExercise()` on both write paths. A test asserting the transcript's own aliases reconcile. |
| Scope creep into a full programming app — periodisation, RPE autoregulation, 1RM math. [PRODUCT.md](../PRODUCT.md) §5 names this the most likely way the project dies. | The server stores sets, reps and a load. Every rule stays in the Skill. If a field would encode a training philosophy, it does not belong in the schema. |
| Phase 4 changes a shipped write path with live data behind it. | Backup first; separate phase; test asserts one workout row per date. |
| **The smoke test is not idempotent** ([GOTCHAS.md](../GOTCHAS.md)) — new assertions on an empty prescriptions table will produce confident nonsense on a second run. | Clear tables before each run, as documented in [DEV.md](../DEV.md). |
| A stale program keeps prescribing into week 9 of a two-week block. | `ends_on` + `status`; `weekOfProgram()` returns null outside the window and `get_session` says so. |

---

## 8. Open decisions

**D-1 — Should E3 (the weekly budget) ship before this? — DECIDED 2026-08-24: no.**
The ranked order stands: events, then pacing, then this. The argument for
pulling E3 forward is recorded below because it remains the strongest case
against the sequence, and is worth revisiting if logging adherence has not moved
by the time this epic starts.

This plan is the better product; E3 may
be the better next move. The live log shows 4 of 7 days logged, 50% protein
adherence and zero weigh-ins in a week — an adherence problem, not a capability
problem. E3 is the intervention the transcript itself prescribes ("budget the
week, not the meal — that's the only version of this that survives your
business"), and it is roughly a third of the work. E1 is worth more once someone
is logging consistently. Carried here rather than buried; the operator's call.

**D-2 — Does a prescription belong to a program, or can it stand alone?**
*Recommendation: both, and `program_id` is nullable.* The transcript contains
exactly one of each — an ad-hoc "I'm going to the gym today" session (S-5) and a
two-week block (S-6). Requiring a program before a session would block the more
common case behind the rarer one.

**D-3 — Per-week target loads, or only the progression rule?**
*Recommendation: both, with the rule as the source of truth.* The transcript gave
explicit Wk 1 / Wk 2 numbers, so `week_offset` supports overriding them. But the
rule is what the model applies when reality diverges — a missed rep means repeat
the weight, and no pre-computed table survives that.

**D-4 — Should the app be able to edit a prescription?**
*Recommendation: no, not in Phase 1.* Conversation is the entry interface
([PRODUCT.md](../PRODUCT.md) §4.1); the web view is for correction. Revisit if
the gym-floor case proves real.

**D-5 — Does `get_briefing` carry the full session or a summary?**
*Recommendation: summary only* — label, exercise count, status. The briefing's
whole reason for existing is one fast round trip; inlining seven exercises with
history would undo it.

---

## 9. Verification

Per phase, proving rather than asserting.

**Every phase**

```bash
npm run typecheck && npm test && npm run recipes:check
```

**Phase 1** — against `wrangler dev` on :8787, tables cleared first
(the smoke test is not idempotent; see [DEV.md](../DEV.md)):

```bash
npm run dev
```

Then, over JSON-RPC to `/mcp/$MCP_PATH_SECRET`:

1. `prescribe_session` with the transcript's real Day B — RDL 3×8 @ 115, bench
   3×8 @ 145, assisted pullup 3×8, cable crunch 3×12, farmer's carry 3×40yd.
2. Assert the **stored rows**, not the response:
   `SELECT exercise, sets, rep_low, target_weight_lb FROM prescribed_sets ORDER BY ordinal`
   → 5 rows, `romanian_deadlift` first at 115.
3. `get_session` → returns those 5, `no_program: true`, and `last: null` for each
   (no history exists).
4. **The critical negative test:** `get_last_performance(["romanian deadlift"])`
   → `sessions_logged: 0`. A prescription must not appear as history.
5. Fetch the rendered page and assert on content, not a 200:
   `curl -s "http://127.0.0.1:8787/app/$APP_VIEW_SECRET" | grep -c "Romanian deadlift"` → `1`.

**Phase 2** — store the transcript's two-week A/B/C block verbatim; assert
`materialize()` yields back squat 175 in week 1 and 185 in week 2, and that
`weekOfProgram()` returns null on day 15.

**Phase 3** — prescribe 5 exercises, `log_workout` 3 of them plus one unplanned;
assert `adherence_pct` is 60 and `unplanned` has 1 entry; assert the prescription
row is `completed` with a non-null `workout_id`.

**Phase 4** — two `log_workout` calls, same date:
`SELECT COUNT(*) FROM workouts WHERE local_date = ?` → `1`.
Run `POST /backup/<MCP_PATH_SECRET>` before touching prod.

**Prod** — the same Phase 1 sequence against the deployed Worker, then delete the
test prescription. Confirm `/health` and the deployment version first.
