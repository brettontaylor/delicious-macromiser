# Macromiser — product definition

**Structured memory for AI-assisted training and nutrition.**

A remote MCP server that gives Claude (and any other MCP client) durable, queryable
state for what you ate and what you lifted — so the coaching conversation stops
starting from zero every session.

---

## 1. The problem

People are already using chat assistants as their nutrition and strength coach. The
conversation quality is genuinely good. The persistence is nonexistent.

Concretely, what breaks:

| Failure | What it looks like in practice |
|---|---|
| No lift history | "What should I bench today?" → the assistant has to ask, or guesses |
| No progression state | Weight never advances systematically; you re-litigate it every session |
| No running daily total | Every macro question requires re-listing everything eaten so far |
| No day-of-week awareness | Recovery timing, training splits, and weekly budgets are all guesswork |
| No trend view | Two-week averages — the only thing that actually indicates progress — are unavailable |
| Estimates never improve | The assistant re-estimates "a chicken breast" from scratch, forever |

Existing tools solve the wrong half. MyFitnessPal and Cronometer have excellent
databases and closed APIs. The MCP nutrition servers that exist (Nutrition MCP,
food-tracker-mcp, Alma) handle food logging well and **training not at all**.

## 2. The thesis

> The database is commodity. The **coaching loop** is the product.

Three consequences that shape every decision downstream:

1. **The server should be dumb.** Storage, retrieval, arithmetic. No opinions.
2. **The judgment lives in a prompt layer** (Claude Skill / Project instructions),
   because coaching rules change weekly and schemas shouldn't.
3. **Training history is the differentiator**, not meal logging. `get_last_performance`
   is the tool nothing else in this space has.

## 3. User objectives

### Primary user (v1): a lifter in a deficit

| # | Objective | Success looks like |
|---|---|---|
| U1 | Log a meal in one sentence, mid-conversation | "Log 3/4 lb ground chicken with farro and salad" — no forms, no database search |
| U2 | Know what's left in the day's budget, instantly | "What am I at?" returns eaten vs. remaining across kcal + 3 macros |
| U3 | Never re-explain training history | Assistant knows the last weight, reps, and RPE for every exercise |
| U4 | Get progression decisions made for me | "Squat today" → the assistant proposes 215 because 205×6×4 was clean |
| U5 | See the truth about a week, not a day | Rolling 7-day averages for intake, protein adherence, and bodyweight |
| U6 | Correct bad estimates once, permanently | Fixing "8oz chicken breast" teaches the system that portion for next time |
| U7 | Separate alcohol from food calories | Because a 2,100-calorie day with 520 of it wine is not a 2,100-calorie day |

### Secondary user (v2+): a friend, or anyone

| # | Objective |
|---|---|
| U8 | Sign up and connect without the maintainer touching anything |
| U9 | Data isolation guaranteed at the server boundary |
| U10 | Export everything; import from MyFitnessPal CSV |

### Explicit non-objectives

- **Not** a food database. Claude's estimates are good enough; corrections close the gap.
- **Not** a social/streak/gamification app. No nagging, no scores.
- **Not** a mobile app. The chat client *is* the mobile app.
- **Not** a wearables integration in v1. Whoop/Apple Health can come later or never.

## 4. Design principles

1. **Conversation is the interface. The web UI is for correction, not entry.**
2. **Every estimate carries a confidence and a source.** Estimated ≠ corrected.
3. **Tools are few and well-described.** Ten good tool descriptions beat thirty tools.
4. **Never lose a write.** Ambiguity resolves to "log it and flag it," not "ask again."
5. **Alcohol is first-class**, not a carb footnote.
6. **The server never coaches.** If it's returning advice, the boundary is wrong.

## 5. Honest risk register

| Risk | Assessment |
|---|---|
| Category is commodity | Real. Working nutrition MCP servers were built in a weekend and given away free. The moat is the coaching layer and the training data, not the CRUD. |
| Consumer fitness retention is brutal | Real. Build this because you want it. Do not model it as a venture without evidence. |
| MCP transport APIs are moving fast | Real. Most tutorials are already stale. Pin to the current official SDK example. |
| Scope creep into "health platform" | The most likely way this dies. Ship Phase 1 and use it for two weeks before writing more. |
| Authless v1 is security-by-obscurity | Acceptable for a single-user personal log. Unacceptable the moment there's a second user. |

## 6. Documents

| File | Contents |
|---|---|
| [`docs/PRODUCT.md`](PRODUCT.md) | This file — problem, thesis, objectives |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, data model, tool surface, auth, deployment |
| [`docs/ROADMAP.md`](ROADMAP.md) | Phased delivery plan with exit criteria |
| [`docs/COACHING-LAYER.md`](COACHING-LAYER.md) | The Skill spec — where all the judgment lives |
| [`docs/DEV.md`](DEV.md) | How to run, test, deploy, and connect it |
| [`skill/SKILL.md`](../skill/SKILL.md) | The coaching layer, written to spec |
| [`README.md`](../README.md) | Repo overview — both halves, layout, commands |

## 7. Status

Phases 0-2 are built and **deployed** (2026-08-23). Eight MCP tools over
Streamable HTTP against Cloudflare D1, 27 unit tests, and a 51-check end-to-end
smoke test that asserts all four Phase 1 exit criteria — passing against
production.

```bash
npm install                   # from the repo root
npm run dev                   # wrangler dev on :8787
npm run smoke                 # in a second terminal
```

Start at [DEV.md](DEV.md). What is left before daily use is claude.ai-side: add
the custom connector, confirm a tool call from the phone, install the Skill.
Then — per [ROADMAP.md](ROADMAP.md) — use it for two weeks before writing more
code. The one exception the roadmap allows is Phase 2.5, which makes the recipe
book macro-aware and is mostly content work rather than server code.
