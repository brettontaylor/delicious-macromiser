# Macromiser — Roadmap

Sequenced so the thing is *usable* at the end of week one and every phase after
that is driven by real data rather than speculation.

**Status (2026-08-23):** Phases 0-2 built and **deployed**. Both D1 instances
created, prod migrated (schema only), Worker live at
`macromiser-prod.macromiser.workers.dev`, 51/51 smoke checks passing against
production, 27 unit tests green. See [DEV.md](DEV.md) to run or deploy it.

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
- [ ] Install as a Claude Skill or Project instructions
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

## US-1 — Log a meal from the app (in progress)

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
- [ ] Phase 0 — spike: can the connector client show an image from a tool result?
- [x] **Phase 1 — the capture queue.** `captures` table, text capture in the
      app, `get_pending_captures` + `resolve_capture`, pending count on
      `get_today`, pending strip in the view. `log_meal` takes a `capture_id`
      and closes the capture in the SAME call — two calls would double the
      approval prompts the user sees
- [ ] Phase 2 — photo upload to R2, size and count caps, retention
- [x] **Phase 4 — the kitchen, as two lists.** `pantry` table with `staple` and
      `fresh`, no quantities and nothing decrementing. `list_recipes` now
      reports `have`/`missing` per recipe and sorts best-covered first;
      `max_missing` filters. Ingredients are scraped from each card's own
      `ul.ingredient-list` at build time, so the card stays the single source
      and cannot drift from an index.

---

## Phase 4 — Multi-user (2–3 weekends)

Only start this when a second person actually wants in.

- [ ] OAuth 2.1: discovery endpoints, DCR (RFC 7591), PKCE S256
- [ ] Redirect handling for `https://claude.ai/api/mcp/auth_callback` and
      port-agnostic loopback for Claude Code
- [ ] Per-user data isolation enforced at the server boundary
- [ ] Signup flow + consent screen
- [ ] MyFitnessPal / Cronometer CSV import
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
| Photo meal logging | High — near-zero behavior change | Low; the model does the work |
| Barcode via Open Food Facts | Medium | Low |
| Whoop / Apple Health import | Medium — real TDEE instead of estimates | High; OAuth per vendor |
| Plan storage (programmed future sessions) | High for adherence | Medium |
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
