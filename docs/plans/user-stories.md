# User stories — derived from a real coaching session

**Date:** 2026-08-24 · **Status:** CATALOG — feeds the re-prioritized [ROADMAP](../ROADMAP.md)
**Source:** `Claude-Chat__core-and-belly-fat-progress-plateau__8.15.2026.txt` — an
unprompted, real coaching conversation held *before* most of this server existed.
**Related:** [PRODUCT.md](../PRODUCT.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) ·
[UI-MAP.md](../UI-MAP.md) · [ROADMAP.md](../ROADMAP.md)

---

## 1. Executive summary

Seventeen discrete interactions were extracted from the transcript and fourteen
more extrapolated. Cross-checked against the build, they sort into eight epics.

**The single most important finding: the transcript contains the model
explicitly asking the user to write something into macromiser that macromiser
cannot store.** On starting creatine — "note it in macromiser so future-you knows
to disregard the first three weeks of scale data." There is no events table.
`bodyweight` (`apps/server/migrations/0001_init.sql:66-72`) is date + weight +
waist, and `apps/server/src/app/chart.ts` draws a rolling average over it with no
way to annotate. A user who starts creatine tomorrow gets a rising 7-day average
during a 550 kcal deficit and no explanation on screen. **That is a correctness
defect in a shipped feature, not a feature request.**

Second finding: the highest-value artifact the model produced in the entire
transcript — a two-week A/B/C block with per-session target loads and a written
progression rule — has nowhere to live. `training_plan`
(`apps/server/migrations/0004_training_plan.sql`) stores one row per weekday with
`kind`, `label`, `notes`. It can express "Tuesday is lower body." It cannot
express "Tuesday is back squat 4×6 @ 185." So "Tuesday is Day A — squats at 215"
died with the context window, which is precisely the failure
[PRODUCT.md](../PRODUCT.md) §1 exists to kill.

Third, and uncomfortable: **the product's current problem is not missing
features.** Live log as of this writing — 4 of 7 days logged, protein adherence
50%, zero bodyweight readings in seven days. The transcript shows why. The model
taught a *weekly* budget ("budget the week, not the meal — that's the only
version of this that survives your business") and the app renders a *daily* ring.
The framing that keeps someone logging after a bad day is not in the UI.

---

## 2. Method

Each story: **id · what the user did or would do · what the build does today
(with `file:line`) · the gap.** Stories marked **OBS** are grounded in the
transcript. Stories marked **EXT** are extrapolated from the same user's evident
loop and from the shape of the tool surface.

Per the `/design-plan` convention, four actors are considered: the **end user**,
**the model** (a first-class consumer — tool descriptions are its UI), the
**operator**, and the **system**.

---

## 3. Observed stories (OBS)

### 3.1 Onboarding and profile

| id | Story | Build today | Gap |
|---|---|---|---|
| **S-1** OBS | User opens with a paragraph of history: a year of training, session frequency, the actual routine, and the goal ("still have belly fat"). The model read and wrote its own memory twice. | Nothing. `set_goals` (`tools/index.ts:146-162`) stores six numbers. `training_plan.notes` is per-weekday free text. | **No athlete profile.** Everything about *who this person is* lived in Claude's private memory — outside the log, non-portable, invisible to a second client. The product promises "never re-explain training history" and this is the part it does not keep. |
| **S-2** OBS | User states confounders unprompted: alcohol, work stress, sleep. The model treated all three as material to the goal. | `meals.alcohol_g` is first-class (`0001_init.sql:29`). Stress and sleep: nothing. | Alcohol covered. Sleep/stress deferred to wearables (E7). |
| **S-3** OBS | User corrects a model inference: "I've had progression on the bench from 115 to 135." The model had asserted the lift was parked, because it had no rows. | `correct_workout` (`tools/correct_workout.ts`) fixes a *logged* set. `import_days` (`tools/import_days.ts`) backfills history. | Tools exist; nothing **prompts** the backfill at onboarding. A model with an empty log will confidently mis-read the user on turn one. |
| **S-4** OBS | User asks how to get an entire chat into the project as durable reference. | `import_days` takes up to 60 days of meals/workouts/bodyweight per call. | Covers the *rows*. Does not cover the *narrative* (S-1) or a program (S-6). |

### 3.2 Training

| id | Story | Build today | Gap |
|---|---|---|---|
| **S-5** OBS | "I'm going to the gym today, what can you suggest?" → the model returns a complete session: warmup, 7 exercises, sets × reps, target loads, supersets (C1/C2), a finisher, and ordering notes. | `get_training_plan` (`tools/training_plan.ts`) returns today's `kind`/`label`/`notes`. `get_last_performance` returns history. | **No prescribed session.** The most valuable output of the conversation is unstorable. Re-derived from scratch every time, and inconsistently. |
| **S-6** OBS | "Can you give me an exercise plan for the next 2 weeks?" → an A/B/C rotation with per-week progression (Wk 1 / Wk 2 columns) and an explicit written rule: *all reps on all sets → +5 lb upper / +10 lb lower; miss → repeat.* | Nothing. `training_plan` is 7 weekday rows. | **No program/block.** The progression rule — which the model itself called "the part people skip and it's the part that works" — is not written down anywhere the system can read. |
| **S-7** OBS | "Tuesday or Wednesday is Day A — squats at 215." A forward-looking load proposal. | `get_last_performance` is backward-looking. `domain/progression.ts:95 buildHistory` builds the evidence; the Skill makes the call. Correct boundary. | The *proposal* is correctly the model's job. But nothing **persists** it, so Tuesday reopens the question. |
| **S-8** OBS | Model prescribes movements the user has never done (RDL, Pallof press, farmer's carry) and flags a missing movement pattern — no hip hinge in the program at all. | `domain/exercise.ts:78 movementPattern()` exists and classifies lifts. | Function exists and **nothing calls it in a tool response.** Pattern coverage over a week is derivable today and is not surfaced. |

### 3.3 Nutrition

| id | Story | Build today | Gap |
|---|---|---|---|
| **S-9** OBS | "I had a 20g protein shake and the remaining ground chicken farro greens mix (1.5-2 cups)." Model logs both, states the estimates, returns the day and what is left. | **Works.** `log_meal` (`tools/log_meal.ts`), `get_today` (`tools/get_today.ts`). | None. This is the loop working as designed. |
| **S-10** OBS | Model asks for macro targets, cannot pin them without bodyweight, publishes a bracket table and asks for the number. | `set_goals` versions goals by `effective_from` (`0001_init.sql:74-84`). `log_bodyweight` upserts. | Not a code gap — a **data** gap. Zero weigh-ins in the live log. The app never asks. |
| **S-11** OBS | Model gives a **weekly** budget and argues for it directly: "Weekly view: multiply by 7. This matters more than the daily number. A wine dinner Friday at 3,200 is completely fine if Thu and Sat run 1,700-1,800. Budget the week, not the meal." | `goals` are daily only. `get_week_summary` (`domain/totals.ts:118 summarizeWeek`) returns 7-day **averages**, not a budget with a remainder. The homepage renders a daily ring (`app/page.ts:229-248`). | **No weekly budget.** The framing the coach actually teaches is absent from the schema and the UI. |
| **S-12** OBS | "100g of protein before mid-afternoon is your best pace yet. Compare to Thursday, when you were at 35g at this point." | `meals.logged_at` exists (`0001_init.sql:19`). `get_today` **does not return it** — verified against a live call: meals carry id, type, description, macros, confidence, source, recipe_slug and no timestamp. | **No intra-day pacing.** The data is already in the table. Nothing exposes it. Cheapest high-perceived-intelligence item in the catalog. |
| **S-13** OBS | "Dinner: ~900 cal, 55g protein. Wide open on carbs. One of the fish or beef options works well here." | **Works.** `get_next_meal` + `list_recipes(max_kcal, min_protein_g, max_missing)`. | None. Phase 2.5 and the pantry phase already landed this. |

### 3.4 Supplements, body, and the confound

| id | Story | Build today | Gap |
|---|---|---|---|
| **S-14** OBS | User asks which whey and creatine to buy; model researches, filters on NSF/Informed Sport certification, recommends, and gives a dose: 3-5 g monohydrate daily, timing irrelevant. | Nothing. | **No supplement stack.** The research is correctly the model's job; the *outcome* ("I take 5 g creatine daily") is durable state and belongs in the log. |
| **S-15** OBS | **The confound.** "Creatine retains 1-2 kg of water… 2-4.5 lbs on the scale within two to three weeks, and it has nothing to do with fat. You're tracking weight toward 190… your rolling average goes up while you're in a 550-calorie deficit, and it'll look like the diet stopped working right when you're two weeks in and most likely to quit." Recommendation: **"Start now and log the date. Note it in macromiser so future-you knows to disregard the first three weeks of scale data. Track waist instead during that window."** | `bodyweight` has `weight_lb` and `waist_in` and no annotation. `app/chart.ts` plots dots + rolling average + an optional target line. | **No events.** The model asked for a write the server cannot accept. Left as-is, the shipped trend chart will actively mislead at exactly the moment it matters most. |
| **S-16** OBS | "Weigh yourself daily, same time, and only look at the 7-day average. If it hasn't dropped 0.5-1.5 lb over two weeks, cut 150 cal from carbs." | The rolling average is implemented (`app/chart.ts`) and `get_week_summary` returns `weight_trend`. The *rule* belongs in `skill/SKILL.md` — correct boundary. | **No review cadence.** A rule that fires "every two weeks" needs something to notice that two weeks elapsed. Nothing does. |
| **S-17** OBS | Rest-day standing rules, verbatim in the plan: *"walk 10,000 steps, no cell phone time, no alcohol."* Model closes with "Today's the zero-alcohol day." | `training_plan.notes` is one free-text string (`0004_training_plan.sql:15`) and the homepage prints it (`app/page.ts:215`). Alcohol is measurable from `meals.alcohol_g`. Steps and phone time are not. | **Rules are printed, never checked.** Three commitments, no completion state, no history of whether they were kept. |

---

## 4. Extrapolated stories (EXT)

Reasoned from the same user's loop, the tool surface, and the failure modes the
schema permits.

| id | Story | Build today | Gap |
|---|---|---|---|
| **S-18** EXT | Logging **during** the session, between sets, from a phone. | `log_workout` takes the whole session in one call, and `skill/SKILL.md` says "one call per session." Calling it twice on one day creates **two workout rows for one date** — nothing merges them. | **No append.** The realistic gym behavior produces duplicate sessions, which then corrupt `countSessionsInRange` (`db/queries.ts:175`) and the weekly session count. |
| **S-19** EXT | A planned session is **missed**. Tuesday says lift; Tuesday passes empty. | `get_week_summary` returns `sessions`; `goals.weekly_sessions` exists. Nothing compares plan to actual per day. | No adherence read on training. The transcript's central prescription was "three sessions, non-negotiable" — the system cannot say whether that happened. |
| **S-20** EXT | **Travel or vacation.** Five days of restaurant food and no weigh-ins. | `get_week_summary` returns `data_quality: "sparse"`. | Averages silently absorb a distorted week. Events (E2) let a trend say "excluding 5 days away." |
| **S-21** EXT | **Injury.** "Shoulder hurts — no overhead pressing for three weeks." | Nothing. | Needs a *bounded window* with a scope — the strongest argument for events carrying `ends_on` rather than being point-in-time. |
| **S-22** EXT | **Deload week.** Planned volume reduction. | Nothing. | Same shape as S-21: a window that changes how both training and weight data should read. |
| **S-23** EXT | **A personal record.** "First time I've hit 225." | `sets` holds every set ever. `buildHistory` (`domain/progression.ts:95`) computes recent sessions. | Best-ever per exercise is derivable and never surfaced. Nothing marks a milestone. |
| **S-24** EXT | **Exercise substitution** — the rack is taken, or a movement hurts. | `movementPattern()` exists (`domain/exercise.ts:78`). | Not exposed in any tool response, so the model substitutes from general knowledge rather than from the user's own history of that pattern. |
| **S-25** EXT | **Sharing progress** with a coach, partner, or friend. | `APP_VIEW_SECRET` exists precisely for this (`index.ts:30-35`, `index.ts:99`). | The capability is built and **has no affordance in the UI**. Nothing tells the user the share link exists. |
| **S-26** EXT | **Undo for every new entity.** | `correct_meal`/`delete_meal`, `correct_workout`/`delete_workout` set the precedent. | Programs, events, supplements and rules each need their own answer, or an explicit statement that they have none. |
| **S-27** EXT | **Shopping list** from the coming week's recipes, diffed against the pantry. | `pantry` (`0005_pantry.sql`), recipe ingredients scraped at build (`domain/pantry.ts:58 matchRecipe`). | Listed in the roadmap; genuinely cheap now that both halves exist. |
| **S-28** EXT | **Steps, sleep, stress** as tracked series. | Nothing. | **Deliberately deferred.** Self-reported 1-5 scores are low-signal; the honest answer is Apple Health / Whoop, which is OAuth-gated. Story recorded; not built. See E7. |
| **S-29** EXT | **A second person** wants in. | Everything resolves `OWNER_USER_ID` (`index.ts:104`, `index.ts:201`). | Phase 4, unchanged. Every story above assumes single-tenant. |
| **S-30** EXT | **Goal horizon.** "Visible core change is a 12-16 week project, not a 4-week one." | `goals.target_weight_lb` has no target date. | No horizon, so no "week 6 of 16" and no honest read on whether the pace is on track. |
| **S-31** EXT | **The model wants to know what it already told this user.** Sessions are independent; advice drifts. | Nothing. | A prescribed session (E1) doubles as the model's own memory of what it committed to. |

---

## 5. The model as an actor

| id | What the model needed | Available? |
|---|---|---|
| **M-1** | On turn one, enough context to avoid a wrong assertion. It said the bench was "parked" because it had no rows. | No. `get_briefing` returns a week; onboarding needs a profile (S-1) and a backfill prompt (S-3). |
| **M-2** | Somewhere to **write down what it prescribed**, so the next session is a continuation rather than a restart. | No. This is E1. |
| **M-3** | A way to record a **caveat about the data itself** — "disregard the scale for three weeks." | No. This is E2, and the model asked for it out loud. |
| **M-4** | Tool descriptions that stop it doing the wrong thing. `resolve_capture` is the model of this: *"Never invent numbers to clear the queue."* | Existing surface is good. Every new tool must carry the same kind of prohibition. |

---

## 6. Epics

| Epic | Stories | Cost | The argument |
|---|---|---|---|
| **E1 — Prescribed session & training block** — 🟡 **Phase 1 shipped 2026-08-24** (S-5, S-7, S-19, M-2); block, append and patterns remain | S-5, S-6, S-7, S-8, S-18, S-19, S-22, S-24, S-31, M-2 | Large | The transcript's highest-value output has nowhere to live. [PRODUCT.md](../PRODUCT.md) §2 names training history *the* differentiator; a prescription is that differentiator pointed forward instead of back. |
| ~~**E2 — Events & annotations**~~ ✅ **shipped 2026-08-24** | S-15, S-20, S-21, S-22 | Small | Fixed the correctness defect. `0006_events.sql`, four tools, chart markers, and the caveat surfaced in `get_briefing` and `get_week_summary`. S-30's goal horizon was **not** covered — it belongs with E3. |
| **E3 — The weekly budget** | S-11, S-16, S-30 | Medium | The framing the coach actually teaches, absent from schema and UI. Directly targets the live adherence problem: 4 of 7 days logged. |
| **E4 — Athlete profile & guided onboarding** | S-1, S-2, S-3, S-4, M-1 | Medium | What the model must never be re-told. Today it lives in Claude's private memory, which is neither portable nor ours. |
| **E5 — Daily adherence: supplements & standing rules** | S-14, S-17, S-19 | Medium | Operator-specified. A stack the user defines, plus one daily checkbox per commitment. Absorbs steps-as-a-rule without a steps integration. |
| ~~**E6 — Pacing, momentum & milestones**~~ ✅ **shipped 2026-08-24** | S-12, S-23, S-25 | Small | All three. `pace` on `get_today`/`get_briefing`, `best_ever` + `personal_records`, and the share link surfaced. No new table — it was all already stored. |
| **E7 — Wearables** | S-28 | Large, gated | Apple Health / Whoop. OAuth per vendor. Correctly Phase 5. |
| **E8 — Multi-user** | S-29 | Large | Phase 4, unchanged. |

---

## 7. Cross-check against the existing roadmap

| Roadmap position | Verdict after this catalog |
|---|---|
| Phase 4 — Multi-user, "only when a second person wants in" | **Holds.** Nothing in the transcript argues for it. |
| Phase 5 — "Plan storage (programmed future sessions) · High for adherence · Medium cost" | **Wrong tier.** This is E1, the single largest gap, listed as an optional extension. **Promote to a named phase.** |
| Phase 5 — Photo meal logging | Already shipped ahead of schedule (US-1 Phase 2). The Phase 5 table is stale. |
| Phase 5 — Whoop / Apple Health | **Holds** as the answer to S-28. |
| Phase 3 — trend chart, shipped | **Carries a latent defect** (S-15). E2 is the fix. |
| Phase 2.5 / pantry / recipes | **Confirmed.** S-13 and S-27 are exactly what they enable. |
| "Two weeks of real use before more code" | **Partly ignored already**, and the live log says the pause is not producing data — 4 of 7 days. E3 and E6 are the interventions most likely to fix that, which is an argument for sequencing them early. |

**Not in the roadmap at all, and should be:** events (E2), the weekly budget
(E3), the athlete profile (E4), supplements and rule adherence (E5), pacing and
milestones (E6).

---

## 8. Recommended sequence

Ranked by value; sequenced by value ÷ cost, with the correctness defect first.

| # | Epic | Why here |
|---|---|---|
| ~~1~~ | ~~**E2 — Events**~~ | ✅ **Shipped 2026-08-24.** |
| ~~2~~ | ~~**E6 — Pacing & milestones**~~ | ✅ **Shipped 2026-08-24.** |
| 🟡 3 | **E1 — Prescribed session & block** | **Phase 1 shipped 2026-08-24.** The block (Phase 2), session append (Phase 4) and pattern surfacing (Phase 5) remain. [training-block.md](training-block.md). |
| 4 | **E3 — Weekly budget** | Reframes the primary surface. Wants E2's events so a travel week can be excluded honestly. |
| 5 | **E5 — Supplements & rules** | Self-contained. Benefits from E2 — a stack start date *is* an event. |
| 6 | **E4 — Profile & onboarding** | Highest value on the *second* user, not the first — the first is already onboarded, in Claude's memory. |
| 7 | **E7 / E8** | Unchanged. Gated. |

**Decided 2026-08-24 — the ranked order above stands.** The deep plan attached to
this catalog is **E1**. The case against, recorded because it is worth revisiting
if adherence has not moved by the time E1 starts: **E3 has a stronger
claim on being built first**: the live log shows an adherence problem, not a
capability problem, and E3 is the intervention the transcript itself prescribes.
E1 is the better product; E3 may be the better next move. Carried as decision
**D-1** in [training-block.md](training-block.md) §8.
