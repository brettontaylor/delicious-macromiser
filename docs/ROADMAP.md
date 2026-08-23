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

## Phase 3 — Correction UI + trends (1 weekend)

Closes the loop that no competing tool closes.

- [ ] `/app` on the same Worker — auth via the same path secret
- [ ] Table of recent entries; inline edit of macros
- [ ] Edits set `source='corrected'`
- [ ] `portion_memory`: corrected portions become reusable phrases
- [x] `get_week_summary` tool: 7-day averages, protein adherence, weight trend
      — pulled forward into Phase 1; a trend view was cheap once totals existed
- [ ] Weight + waist trend chart
- [ ] CSV export

**Exit:** correcting an estimate once measurably improves the next estimate of
the same food.

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
