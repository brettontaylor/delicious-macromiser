# Macromiser — Roadmap

Sequenced so the thing is *usable* at the end of week one and every phase after
that is driven by real data rather than speculation.

**Status (2026-08-23):** Phases 0-2 built and **deployed**. Both D1 instances
created, prod migrated (schema only), Worker live at
`macromiser-prod.macromiser.workers.dev`, 51/51 smoke checks passing against
production, 66 unit tests green. See [DEV.md](DEV.md) to run or deploy it.

What remains in Phases 0-2 is claude.ai-side only: add the custom connector,
confirm a tool call from the phone, install the Skill.

The recipe book moved into this repo the same day, which is what makes Phase 2.5
below possible — see the root [README](../README.md).

---

## Phase 0 — Spike (½ day)

Prove the connection before building anything.

- [x] Cloudflare Worker with a single MCP tool: `ping` → `"pong"`
- [x] Streamable HTTP at `/mcp/<random>`
- [x] Add as a custom connector in claude.ai (Settings → Connectors → Add custom)
- [x] Confirm the tool is callable from a chat
- [ ] Confirm it also appears on Claude mobile

**Exit:** Claude on your phone can call a tool on your Worker.

> Do this first. If the connector handshake is going to fight you, find out
> in an afternoon rather than after building a data model.

---

## Phase 1 — Usable single-user log (1 weekend)

The minimum that replaces this conversation's manual tracking.

- [x] D1 schema: `meals`, `workouts`, `sets`, `bodyweight`, `goals`
- [x] Tools: `log_meal`, `log_workout`, `log_bodyweight`, `get_today`,
      `get_last_performance`, `set_goals`
- [x] Timezone-correct `local_date` on write
- [x] Alcohol tracked separately in `alcohol_g`
- [x] `get_today` returns eaten / remaining / food-kcal-excluding-alcohol
- [x] Tool descriptions written deliberately (this is the highest-leverage hour
      in the whole phase)
- [x] Nightly D1 export to R2 — cron on the prod Worker, 30-day retention,
      bucket `macromiser-backups`. Restore path verified end-to-end
      (see [DEV.md](DEV.md) §2c)

**Exit criteria — all four:**
1. "Log lunch: 12oz ground chicken, ¼ cup farro, salad with 3 tbsp olive oil"
   writes correctly, unprompted, from a normal conversation.
2. "What am I at?" returns the day without re-listing anything.
3. "What did I squat last time?" returns 205 × 6 × 4.
4. It works from the phone at the gym.

> **Then stop and use it for two weeks.** No new code. The schema is wrong in
> ways no design session will reveal — only usage will.

---

## Phase 2 — The coaching layer (1 evening)

Where the actual value is.

- [x] Write `SKILL.md` (see `COACHING-LAYER.md`)
- [x] Encode: macro targets, progressive-overload rule, recovery spacing,
      alcohol-adjusted food-calorie check, protein-priority ordering
- [ ] Install as a Claude Skill or Project instructions. `npm run skill:build`
      packs `skill/SKILL.md` into `dist/macromiser-coach.zip` (gitignored).
      **Re-upload needed** — and this is the step that quietly undoes a deploy:
      on 2026-08-24 the uploaded zip was found 91 lines behind, carrying no
      rules for events, pace, personal records, prescriptions or programs, all
      of which had just shipped. It was hand-zipped, which is why it drifted;
      there is a build script now.
- [ ] Iterate on the prompt for a week — it's a text file, not a deploy

**Exit:** you ask "gym today?" and get a session with correct loads, correct
recovery spacing, and no re-explanation of your history.

---

## Phase 2.5 — Recipes become macros — ✅ done 2026-08-23

The reason the recipe book and the server share a repo. A recipe you actually
cooked is the highest-confidence food entry that can exist: the portions are
known, the ingredients are known, and you wrote them down. Every such meal
logged as "roughly 700 calories" is a measurement thrown away.

- [x] Extend `RECIPE_FORMAT.md` with a `schema.org/Recipe` JSON-LD spec —
      `recipeYield`, `NutritionInformation`, and an `x-components` breakdown so
      a serving eaten without the rice can still be logged accurately.
      Six rules, including the one that matters: only count what the ingredient
      list actually contains
- [x] **Backfill the existing recipes** — all six carry per-serving nutrition,
      summed per ingredient from each card's own list and divided by its yield
      (larger end of a range). Each also carries an `x-components` split, so a
      serving eaten without the rice or polenta logs accurately.

      Ethanol is not counted; dry wine contributes almost nothing once it cooks
      off. An Atwater cross-check (4/9/4) now runs in the build and every card
      lands within 2% of its stated calories.

- [x] Flipped `ENFORCE_NUTRITION` to `true` in `scripts/check-recipes.mjs` so CI
      keeps it true from then on
- [x] `scripts/build-recipe-catalog.mjs` — parses the cards into
      `apps/server/src/generated/recipes.json`, bundled into the Worker at
      deploy (wired into `deploy:prod`). No D1 table, no sync step. Rejects a
      partial nutrition block rather than logging a missing macro as zero;
      runs in CI. Parser verified against fixtures
- [x] Migration `0002_recipe_link.sql`: `recipe_slug` column + partial index, and extend the
      `source` enum with `'recipe'` alongside `estimate|corrected|barcode|import`
- [x] `log_meal` accepts `recipe_slug` + `servings` → exact macros, `confidence`
      = high, description auto-filled from the recipe title
- [x] New tool `list_recipes` — returns slug, title, servings, per-serving macros

**Exit:** "log two servings of the galbi jjim" writes exact macros, and
"what can I make tonight with 60g of protein left?" is answerable.

> Why JSON-LD in the HTML rather than a sidecar `.json`: the card stays the
> single source of truth and stays print-ready, `schema.org/Recipe` is a real
> standard so there is no format to invent, and the same markup is what a
> Phase 5 web UI would need for search and structured data anyway.

**Depends on:** nothing in Phase 3. This can run before or after the correction
UI — but it should run *before* Phase 4 (multi-user), because a shared recipe
catalog is a much better reason for a second user than a shared macro log.

---

## Phase 3 — Correction UI + trends — ✅ done 2026-08-23

Closes the loop that no competing tool closes.

- [x] `/app` on the same Worker — its own read-only secret, not the write one
      (see [DEV.md](DEV.md) §2b)
- [x] `correct_meal` / `delete_meal` tools — partial edits, soft delete.
      Until now there was no undo at all short of hand-editing prod SQL
- [x] Inline edit in the web view — a `<details>` per meal keeps the day
      scannable and opens number inputs only for the one being fixed. Plain
      form POSTs with Post/Redirect/Get; no client JavaScript. Gated on a
      third secret so the shareable read link cannot write
- [x] Edits set `source='corrected'` and raise confidence to high — a human
      has now looked at the numbers, which is different evidence
- [x] `portion_memory`: corrected portions become reusable phrases, surfaced
      on every `get_today` as `known_portions`
- [x] `get_week_summary` tool: 7-day averages, protein adherence, weight trend
      — pulled forward into Phase 1; a trend view was cheap once totals existed
- [x] Weight + waist trend chart — inline SVG, no chart library. Raw
      weigh-ins are faint dots, the 7-day rolling average is the line, matching
      the Skill's rule that a single reading is noise. Scaled to the data, never
      to the target: a goal 20 lb away would otherwise crush every real reading
      into a strip at the top. An off-scale target is annotated instead
- [~] CSV export — **dropped 2026-08-23.** Import and export belong in
      predefined MCP connectors (other trackers, Apple Health, running apps),
      not in a one-off file format. A CSV would be a second integration surface
      to maintain that nothing would consume.

**Exit:** correcting an estimate once measurably improves the next estimate of
the same food.

---

## Training plan — ✅ done 2026-08-23

Prompted by a real observation: the homepage answered "what did I lift" and had
nothing to say about "what am I supposed to do today", which is the question
someone actually opens the app with. Everything in the database until now was a
record of the past.

- [x] `training_plan` table — one row per weekday. Not a rotating cycle: people
      say "lower body on Tuesday", and a schedule you cannot state in those
      words is one you will not follow.
- [x] `set_training_plan` upserts a day at a time, so moving leg day is one call
      rather than a rewrite of the week.
- [x] `get_training_plan` returns today's kind, label and the user's own
      standing rules, plus how many days to the next lift. Facts only —
      `no_plan_set` distinguishes "never set up" from "today is rest", which
      read the same on screen and mean opposite things.
- [x] Homepage renders it above the ring: the day, the user's rules verbatim,
      and "Next lift Tuesday — Lower body". Disappears entirely with no plan.
- [x] 10 unit tests, including the wrap-around week and refusing to invent a
      rest day for someone who never set one.

---

## Workout corrections — ✅ done 2026-08-23

Not on the original roadmap. Found by asking which writable entities had an
undo: meals had `correct_meal` and `delete_meal`; workouts had neither, despite
`deleted_at` sitting unused in the schema since `0001_init.sql`.

The asymmetry mattered more than it looked. A wrong meal number sits in an
average. A wrong SET number propagates — `get_last_performance` reads it and the
Skill proposes the next load from that, so a mistyped rep count keeps producing
a wrong recommendation until someone notices, and training history is the thing
this project exists to get right.

- [x] `correct_workout` — sets addressed by `set_no` ("the third set was only 3
      reps"), `remove: true` for a set that never happened, `null` for a value
      genuinely unknown. Session label and notes too.
- [x] `delete_workout` — soft delete, recoverable.
- [x] `get_last_performance` now returns `workout_id` on every session. Without
      it the correction tools were unreachable from the one place a wrong number
      is actually noticed.

---

## Recipes in the app — ✅ done 2026-08-23

Phase 4 gave the MODEL the pantry-matched catalog and gave the cook nothing:
"what can I make tonight" still meant opening a chat. `/app/<secret>/recipes`
is the same data with a thumb-sized interface — what fits today's remaining
budget first, then best-covered by the pantry, with the shopping gap behind a
disclosure per recipe.

Read-only for both capabilities: the book and the pantry are not sensitive the
way the food log is.

Prompted a refactor worth having on its own — the shell (tokens, `esc`, the
no-store/no-referrer/noindex headers) moved to `src/app/layout.ts`. Two pages
with two copies of a stylesheet is how a design system starts drifting, and the
point of lifting these tokens from macromiser.vercel.app was that the two
products read as one. Also fixed `HEAD`, which returned 405 where it should
behave like `GET`.

---

## Conversation latency — ✅ done 2026-08-24

Operator feedback: the back-and-forth of MCP calls made the chat feel blocked.
Measured before changing anything — individual calls run 120-250ms, so the server
was never the problem. Four sequential calls to orient were.

- [x] `get_briefing` — the day, what is left, the capture queue **with notes
      inline**, the training plan and next lift, the week's shape, bodyweight,
      and corrected portions, in ONE parallel round.
      **1209ms across 4 calls → 200ms in 1.** The milliseconds are the smaller
      half: four calls is also four approval prompts and four pauses.
- [x] `get_today` had two queries outside its `Promise.all` — 651ms → 233ms.
- [x] The Skill now opens with §0 "the first tool call of any session is
      `get_briefing`".

> Correctness gap this surfaced: the Skill's rule to check `pending_captures` at
> session start **did not fire**. The queue was noticed only because the user
> asked about a meal and `get_today` mentioned it in passing. An instruction to
> make an extra call is weaker than putting the thing in a payload the model
> already reads — hence notes inline.

---

## US-1 — Log a meal from the app — ✅ all phases done 2026-08-24

Planned in [plans/us-1-log-a-meal-in-the-app.md](plans/us-1-log-a-meal-in-the-app.md)
with the ported `/design-plan` skill. Decisions taken: capture-then-analyze
rather than app-side inference (the connector already IS the user's model, and
consumer users have subscriptions rather than API keys); pantry as two small
lists rather than an inventory.

- [x] **Phase 3 — next meal.** `src/domain/mealtimes.ts` predicts the next slot
      from the user's own same-day logs; `get_next_meal` returns it with the
      remaining budget; the view renders a line under the ring. Only meals
      logged on the day they were eaten count — a backfilled row carries the
      time it was *written*, so including it would learn the time of the import.
      Below three observations it returns null with a reason rather than
      guessing. 10 unit tests.
- [x] **Phase 0 — spike: PASSED.** A fresh chat read a 3x3 grid back exactly
      (1 in 512). The client does pass an image content block to the model.
- [x] **Phase 1 — the capture queue.** `captures` table, text capture in the
      app, `get_pending_captures` + `resolve_capture`, pending count on
      `get_today`, pending strip in the view. `log_meal` takes a `capture_id`
      and closes the capture in the SAME call — two calls would double the
      approval prompts the user sees
- [x] **Phase 2 — photo capture.** File input on the app (opens the camera on a
      phone), stored in R2, returned to the model as an image content block by
      `get_pending_captures`. 4 MB cap, 40/day cap, 14-day retention on the
      OBJECT while the capture row survives — the log keeps its history, the
      picture does not linger. Verified byte-identical round-trip on prod.
- [x] **Phase 4 — the kitchen, as two lists.** `pantry` table with `staple` and
      `fresh`, no quantities and nothing decrementing. `list_recipes` now
      reports `have`/`missing` per recipe and sorts best-covered first;
      `max_missing` filters. Ingredients are scraped from each card's own
      `ul.ingredient-list` at build time, so the card stays the single source
      and cannot drift from an index.

---

## Re-prioritized 2026-08-24 — what the real transcript changed

A year-old coaching conversation
(`Claude-Chat__core-and-belly-fat-progress-plateau__8.15.2026.txt`) was read
back against the build and turned into 31 user stories in
[plans/user-stories.md](plans/user-stories.md). Three things came out of it that
this roadmap did not have.

**One: a shipped feature carries a latent defect.** The transcript has the model
telling the user to "note it in macromiser so future-you knows to disregard the
first three weeks of scale data" — creatine adds 2–4.5 lb of water while the
diet is working. There is no events table, so the Phase 3 trend chart will show
a rising 7-day average during a deficit with nothing on screen to explain it.
That is not a feature request.

**Two: "plan storage" was filed as an optional Phase 5 extension.** It is the
largest gap in the product. The transcript's most valuable artifact — a two-week
A/B/C block with target loads and a written progression rule — has nowhere to
live, which is exactly the failure [PRODUCT.md](PRODUCT.md) §1 exists to kill.
Promoted, and planned in [plans/training-block.md](plans/training-block.md).

**Three: the current problem is adherence, not capability.** Live log at time of
writing — 4 of 7 days logged, protein adherence 50%, zero weigh-ins in a week.
The transcript shows the fix, and the app does not implement it: the coach
teaches a *weekly* budget ("budget the week, not the meal — that's the only
version of this that survives your business") and the homepage renders a daily
ring.

### The next six, in order

| # | Epic | Stories | Size | Why here |
|---|---|---|---|---|
| ~~1~~ | **Events & annotations** — ✅ **shipped 2026-08-24** | S-15, S-20, S-21, S-22 | done | See below. |
| ~~2~~ | **Pacing & milestones** — ✅ **shipped 2026-08-24** | S-12, S-23, S-25 | done | See below. |
| ~~3~~ | **Prescribed session** — ✅ **Phase 1 shipped 2026-08-24**; the multi-week block is what remains | S-5 … S-8, S-18, S-19, S-24, S-31 | The epic | [plans/training-block.md](plans/training-block.md). Two entities: a **program** (the standing block) and a **prescription** (one dated session with real loads). The comparison between prescription and log is adherence, and nothing else in this space has it. |
| 4 | **The weekly budget** | S-11, S-16, S-30 | Medium | Weekly kcal target beside the daily one, week-to-date pacing, and a goal horizon so "week 6 of 16" is answerable. The framing that survives a bad Friday. |
| 5 | **Supplements & standing rules** | S-14, S-17, S-19 | Medium | A stack the user defines, plus one daily checkbox per commitment. Absorbs "walk 10,000 steps" and "no alcohol" — already written in `training_plan.notes` and never checked off — without needing a steps integration. |
| 6 | **Athlete profile & onboarding** | S-1 … S-4, M-1 | Medium | Today the answer to "who is this person" lives in Claude's private memory: not portable, not ours, and invisible to a second client. Worth most on user #2. |

> **Decided 2026-08-24 — this order stands.** #4 had an arguable claim on going
> first, because the live log shows an adherence problem rather than a capability
> one. Revisit if logging adherence has not moved by the time #3 starts. Recorded
> as D-1 in [plans/training-block.md](plans/training-block.md) §8.

**Deliberately still deferred:** steps, sleep and stress as tracked series
(S-28). Self-reported 1–5 scores are low-signal; the honest answer is Apple
Health / Whoop, which is OAuth-gated and correctly sits in Phase 5.

Every item above renders as a greyed placeholder where it will live, plus a row
on `/app/<secret>/roadmap`. Page-by-page wireframes: [UI-MAP.md](UI-MAP.md).

---

## Events and annotations — ✅ done 2026-08-24

The first item off the re-prioritized list, and the one that repaired something
already shipped. `0006_events.sql`.

- [x] `events` table with **three** dates, each doing a distinct job.
      `starts_on` when the thing began; `ends_on` when it stopped, NULL for
      ongoing; `caveat_until` for how long it distorts the readings. Creatine
      taken daily never ends but stops moving the scale in about three weeks —
      collapsing those two into one column loses one of them.
- [x] `affects` — `weight | training | nutrition | all | none`. The transcript's
      advice was exactly this shape: "track waist instead during that window."
      Weight is clouded, waist is not, and the model needs to know which.
- [x] `log_event`, `get_events`, `correct_event`, `delete_event` — soft delete,
      partial correction, and `null` to clear a date, matching `correct_meal`.
- [x] **Surfaced where it will actually be read.** `get_briefing` carries
      `events.clouded_readings` and `bodyweight.clouded_by`;
      `get_week_summary` carries `events_in_window`. The latency work already
      taught us this: an instruction to make an extra call is weaker than a
      field in a payload the model already reads.
- [x] Chart markers — a dashed rule where it started, a faint band while the
      caveat holds, and the event named underneath. **Only events affecting
      weight are drawn**; an injury does not explain the scale, and a marker
      implying it would be worse than none.
- [x] 15 unit tests, and `npm run verify:events` — 33 end-to-end assertions
      against a running server, including the negative one that matters: a
      non-weight event must not appear on the weight chart. Unlike the smoke
      test, it clears its own tables first.

The Skill learned the rule that makes it worth anything: never read a weight
trend without checking `clouded_readings`, lead with the reason rather than the
number, switch to waist for the duration, and never recommend a calorie cut on
a clouded trend.

---

## Pacing, milestones and the share link — ✅ done 2026-08-24

Nothing new stored. Everything here was already in the tables and simply had no
way out.

- [x] `src/domain/pacing.ts` — today's protein against the **same clock time**
      on past days. `get_today` and `get_briefing` return `pace`; the homepage
      renders "90 g protein by 2:00pm — your best pace yet".
- [x] **`meals.logged_at` is now returned by `get_today`.** It has been in the
      schema since `0001_init.sql` and no tool ever exposed it, so the model
      could only ever see a finished daily total.
- [x] Only same-day-logged meals count, matching `mealtimes.ts`. A backfilled
      row carries the time it was *written* — importing three weeks at 9pm on a
      Sunday would otherwise read as three weeks of 9pm dinners. Verified: three
      imported days still yield `days_compared: 0`.
- [x] A day that was logged but empty by the cutoff counts as a **real zero**.
      Dropping it would flatter today by comparing only against good days.
- [x] Below three comparable days it returns null with a `reason` rather than
      inventing a baseline. Ties are not a personal best.
- [x] `getBestSets` — heaviest **completed** set ever per lift, dated to when it
      was first hit. `log_workout` returns `personal_records`;
      `get_last_performance` returns `best_ever`. A failed attempt at 235 is not
      a 235, and a first-ever logged load is not a PR — both are tested.
- [x] **The share link finally has an affordance.** `APP_VIEW_SECRET` has
      existed since Phase 3 and nothing in the UI mentioned it. Shown only to
      the edit capability, with what it does and does not grant.
- [x] 12 unit tests plus `npm run verify:pacing` — 32 end-to-end assertions.

---

## The prescribed session — ✅ Phase 1 done 2026-08-24

The largest gap the transcript exposed, and the first phase of
[plans/training-block.md](plans/training-block.md). `0007_prescriptions.sql`.

- [x] `prescriptions` + `prescribed_sets`, **deliberately separate from
      `workouts` and `sets`.** Intent and fact must never share a table: a
      planned 185 that becomes the base for the next progression is a lifter
      programmed off a session they never did, and `get_last_performance` drives
      every load in the product. Keeping them apart means `getSetsForExercise`
      cannot see a prescription by construction rather than by a `WHERE` clause
      someone can forget. **A test asserts exactly this** — after writing a
      six-exercise plan, `get_last_performance` still reports zero sessions and
      the `sets` table is empty.
- [x] `prescriptions.workout_id` is a plain column, not a foreign key —
      GOTCHAS records what the mutual `captures`↔`meals` keys did to
      `restore.mjs`.
- [x] `prescribe_session` — the model writes down what it just proposed, and
      the tool reads it back ("Romanian deadlift 3×8 @ 115") so a wrong load can
      be corrected in the same breath. Re-prescribing a **planned** date
      replaces it; a **completed** one is left alone.
- [x] `get_session` — the plan **and** `last` / `best_ever` per lift in one
      round trip, so adjusting a session does not cost a second call. Returns
      no recommendation. `no_prescription` is distinct from a rest day, the
      same distinction `get_training_plan`'s `no_plan_set` makes.
- [x] `log_workout` accepts `prescription_id`, marks the plan completed and
      returns **reconciliation** — planned against done — in the same call. Two
      calls would double the approval prompts, which `log_meal` + `capture_id`
      already settled. Omit the id and the day's prescription links itself.
- [x] Exercise names are normalized on **both** write paths, so a plan saying
      "RDL" reconciles against a log saying "Romanian Deadlifts". Tested, because
      without it reconciliation silently reports 0%.
- [x] The session renders above the ring, one-handed, with a `logged` chip once
      reconciled.
- [x] 15 unit tests plus `npm run verify:session` — 50 end-to-end assertions.

---

## The multi-week block — ✅ Phase 2 done 2026-08-24

`0008_programs.sql`. The other half of the transcript's programme: not just
"Tuesday is Day A" but the whole two-week A/B/C rotation, with the progression
rule the model itself called *"the part people skip and the part that works"*.

- [x] `programs` / `program_days` / `program_exercises`. Days are **keyed by
      weekday**, mirroring `training_plan` for the reason that migration already
      defends: people say "lower body on Tuesday", and a rotating N-day cycle
      would be more general and less usable.
- [x] `progression_rule` stored **verbatim and never parsed**. It is coaching,
      it changes weekly, and the Skill applies it.
- [x] `week_offset` carries the transcript's "Wk 1: 175 / Wk 2: 185" without
      duplicating the day — send the lift twice, once plain and once with
      `week: 2`. The rule still outranks it: a missed rep in week 1 makes a
      pre-computed week-2 number wrong.
- [x] **`weekOfProgram` returns null past the end rather than clamping.** A
      two-week block read on day 15 says the block is over; serving its last
      week forever is worse than having no block at all. Tested, and
      `prescribe_session(from_program)` refuses on an expired date.
- [x] `get_session` offers `from_program.suggested` — today's template with
      `last` and `best_ever` beside each lift — **without writing it.** A
      session the user never agreed to is not a plan, and auto-writing would
      fill the log with sessions nobody intended.
- [x] `prescribe_session(from_program: true)` materializes it once the user
      agrees, taking the day's label with it.
- [x] `set_program` retires the active block; `end_program` distinguishes
      *completed* from *abandoned*, which is worth recording honestly.
- [x] 10 unit tests plus `npm run verify:program` — 46 end-to-end assertions
      against the transcript's real block.

**Still open in this epic:** session append for logging between sets (Phase 4),
and surfacing movement patterns on `get_last_performance` (Phase 5).

---

## Phase 4 — Multi-user (2–3 weekends)

Only start this when a second person actually wants in.

- [ ] OAuth 2.1: discovery endpoints, DCR (RFC 7591), PKCE S256
- [ ] Redirect handling for `https://claude.ai/api/mcp/auth_callback` and
      port-agnostic loopback for Claude Code
- [ ] Per-user data isolation enforced at the server boundary
- [ ] Signup flow + consent screen
- [~] MyFitnessPal / Cronometer CSV import — **dropped**, same reasoning as the
      Phase 3 export: import belongs in predefined MCP connectors (Apple Health,
      other trackers), not a one-off file format
- [ ] Rate limiting, audit logging
- [ ] Privacy policy and data-deletion path

**Exit:** someone who has never met you can connect and use it without you
touching a console.

> This is the phase where a weekend project becomes an operational commitment.
> Storing other people's health data carries real obligations. Decide
> deliberately, not by drift.

---

## Phase 5 — Optional extensions

Only if Phases 1–3 have survived three months of daily use.

| Extension | Value | Cost |
|---|---|---|
| ~~Photo meal logging~~ | — | **Shipped 2026-08-24** (US-1 Phase 2), ahead of this table |
| Barcode via Open Food Facts | Medium | Low |
| Whoop / Apple Health import | **High** — and the only honest answer to steps, sleep and stress (S-28) | High; OAuth per vendor |
| ~~Plan storage (programmed future sessions)~~ | — | **Promoted** out of "optional" — it is the largest gap in the product. See "Re-prioritized" above and [plans/training-block.md](plans/training-block.md) |
| Claude Skill published to directory | Distribution | Medium |
| Connector directory submission | Distribution | High — requires Team/Enterprise org, screenshots, populated test account, review |

### Absorbed from the recipe-book roadmap

The recipe book arrived with its own phased plan. Now that the two live in one
repo, its later phases are extensions of this one rather than a parallel track.
Each becomes worth building only once Phase 2.5 has made recipes macro-aware.

| Extension | Value | Depends on |
|---|---|---|
| `pantry.json` / `fridge.json` — what is on hand | Medium — turns "what can I make?" into a real answer | Phase 2.5 |
| "What can I make?" from pantry + remaining macros | High — the question the two halves exist to answer together | Phase 2.5 + pantry |
| Shopping list from a recipe, diffed against pantry | Medium | pantry |
| Receipt scanning → parse line items → update pantry | Medium | pantry; high effort |
| Recipe tagging + search (protein, cuisine, time) | Medium — cheap once the catalog is structured | Phase 2.5 |
| `apps/web` — browse, search, print the library; pantry dashboard; meal planner | High, and the natural home for the correction UI from Phase 3 | Phase 2.5 |

> The web UI is listed once, here. The Phase 3 correction UI and the recipe
> book's "Phase 5 — The App" are the same app; building them separately would
> mean two front-ends over one D1.

---

## Sequencing rationale

**Why `get_last_performance` in Phase 1.** It's the differentiator. If it slips
to Phase 3 you'll have built another nutrition tracker, of which there are
already several, free.

**Why the coaching layer is Phase 2, not Phase 1.** It's a text file. It should
be cheap to change and it will change weekly. Coupling it to a deploy cycle is
the single most likely way to make this unpleasant to iterate on.

**Why OAuth is Phase 4.** It's roughly 80% of total engineering effort and 0% of
personal value. Authless with an unguessable path is a legitimate v1 for one
user — and an illegitimate v1 for two.

**Why the two-week pause after Phase 1.** Every schema decision in
`ARCHITECTURE.md` is a hypothesis. Two weeks of real logging will invalidate
several of them cheaply. Building Phase 3 on unvalidated Phase 1 assumptions is
how side projects accumulate rework and then die.

---

## Definition of done for the whole project

You stop tracking anything manually, the assistant knows your history without
being told, and you'd be annoyed if it disappeared.

Nothing about users, growth, or revenue. If those become goals later, they need
their own evidence.
