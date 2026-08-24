# US-1 — Log a meal from the app

**Date:** 2026-08-23 · **Status:** COMPLETE 2026-08-24 — spike passed, Phases 1, 2, 3 and 4 all shipped
**Triggered by:** "I want to add a meal via the app… it should use the user's
connected Claude (OpenAI, Gemini, etc.) connector to analyze and add the meal,
rather than our app's tokens."
**Related:** [PRODUCT.md](../PRODUCT.md) · [ARCHITECTURE.md](../ARCHITECTURE.md) ·
[ROADMAP.md](../ROADMAP.md) · [DEV.md](../DEV.md)

---

## 1. Executive summary

The app can capture a meal today in exactly zero ways: `apps/server/src/app/page.ts`
renders one form, and it edits an existing entry. Adding a create path is
straightforward. The interesting half of this request is *who analyzes the photo*.

**The most important finding: "bring your own LLM" is already true, and the
proposed architecture would break it.** The user's LLM already reaches this
server through the MCP connector — that is their subscription, their tokens,
their choice of model. Making the *app* call an LLM would require API keys, and
consumer users do not have API keys; they have subscriptions, which grant no API
access. We would end up either holding user API keys (a real security liability
for a health app) or paying for inference ourselves — the exact thing this
request is trying to avoid.

So the recommended design inverts it: **the app captures, the user's model
analyzes.** A photo or a scribbled note becomes a `pending_capture` row plus an
object in R2. A new `get_pending_captures` tool hands those to whichever model
the user talks to next, which estimates the macros and calls `log_meal` exactly
as it does today. Zero API keys, zero inference cost, works with any MCP client,
and the analysis quality is whatever model the user pays for.

The cost is latency: a photo is not macros until the user opens their assistant.
That is a real trade and it is decision **D-1** below.

Pantry gets a recommendation too, and it is "don't build inventory" — see §7.

---

## 2. Current-build map

| Area | Owner | State |
|---|---|---|
| Meal writes | `src/mcp/tools/log_meal.ts:18` | Full macros, or a `recipe_slug`. Backdating via `resolveWhen` (`src/mcp/tools/args.ts:100`) |
| App writes | `src/app/write.ts:30` | Form POST → edit or soft-delete an **existing** meal. No create path |
| App capability | `src/index.ts:91` | Three secrets → read / edit. Resolved per request |
| Portion learning | `src/db/queries.ts:342`, surfaced at `src/mcp/tools/get_today.ts:59` | A corrected phrase is remembered and returned as `known_portions` |
| Reference data | `src/domain/recipes.ts:35` | Bundled at build, not stored in D1 |
| Object storage | `src/index.ts:37` | R2 `BACKUPS` bound already — a second bucket is trivial |
| Tool results | `src/mcp/server.ts:38` | **Text only.** No image content block is emitted today |
| Protocol | `src/mcp/rpc.ts:21` | `2025-11-25`, falling back to `2025-06-18` |

**Verified:** all of the above by reading the files.
**Assumed, and load-bearing:** that an MCP tool result carrying an `image`
content block is rendered to the model by claude.ai's connector client. The
protocol defines image content; whether *this* client passes it to the model is
unproven. Phase 0 exists to find out in an afternoon, mirroring the roadmap's
own "prove the connection before building a data model" habit.

---

## 3. User stories

### End user

| id | Story | Current build | Gap |
|---|---|---|---|
| US-1.1 | Log a meal from the app without opening a chat | Nothing. Only edit exists (`write.ts:30`) | Whole create path |
| US-1.2 | Photograph what I am eating and have it logged | Nothing | Capture, storage, and an analyzer |
| US-1.3 | Not pay for a second AI subscription | Already true — the connector uses their own model | Preserve it. Do not introduce app-side inference |
| US-1.4 | See what and when I will probably eat next when I open the app | Nothing | Meal-time pattern + remaining budget |
| US-1.5 | Fix a photo-derived estimate | `correct_meal` and the edit form both work once logged | Works, provided a capture becomes a normal meal row |
| US-1.6 | Ideas from what is in the house / where I order from | Nothing. `list_recipes` knows the book, not the kitchen | See §7 — recommended shape differs from the request |

### The model

| id | Story | Current build | Gap |
|---|---|---|---|
| US-1.7 | Know a photo is waiting without being told | Nothing | `get_pending_captures`, plus a Skill rule to check on session start |
| US-1.8 | See the photo well enough to estimate | Tool results are text-only (`server.ts:38`) | Image content block, or a fetchable URL |
| US-1.9 | Not double-log a capture already handled | Nothing | A resolved state, set in the same call that logs |
| US-1.10 | Know when a capture is too poor to estimate | Nothing | A path to mark it unusable rather than guess |

### Operator

| id | Story | Current build | Gap |
|---|---|---|---|
| US-1.11 | Not hold anyone's API keys | True today | Keep it true. This is the argument against app-side inference |
| US-1.12 | Photos do not accumulate forever | Backups prune at 30 days (`src/backup.ts`) | Same retention for captures |
| US-1.13 | A capture that is never analyzed is visible, not silently lost | Nothing | Show pending count in the view |

### System

| id | Story | Current build | Gap |
|---|---|---|---|
| US-1.14 | Nightly backup covers captures | Backs up all D1 tables | New table is picked up automatically; R2 objects are not, and need not be |
| US-1.15 | An upload cannot exhaust storage | Nothing | Size cap and per-day count cap |

---

## 4. The architecture decision, stated plainly

Three ways to satisfy "use the user's own LLM":

**(A) App calls a provider with the user's API key.**
Rejected. Consumer users have subscriptions, not API keys — claude.ai, ChatGPT
Plus and Gemini Advanced grant no API access, so this serves almost nobody who
would actually use it. It also means custody of user API keys in a health app,
per-provider adapters, and a settings surface for each. High cost, low coverage,
real liability.

**(B) App captures; the user's model analyzes over MCP.** ← recommended
The connector already is the user's LLM. A capture is a row plus an object; the
next conversation drains the queue. No keys, no inference cost, no provider
adapters, and it works identically for any MCP-capable client. Cost: analysis is
asynchronous.

**(C) MCP sampling — the server asks the client's model for a completion.**
This is what the protocol invented for exactly this problem, and it is the right
long-term answer. It is not available now: this transport is deliberately
stateless and hand-rolled and cannot initiate server→client messages
([DEV.md §5](../DEV.md)), and client support is uneven. Revisit when the
transport moves; do not build on it today.

**Recommendation: (B), with (C) named as the migration path.**

---

## 5. Technical design

### Phase 0 — spike — RUN 2026-08-23, one step outstanding

**Built and deployed.** `spike_image` returns a 3x3 grid of filled/empty cells
as an MCP `image` content block. 512 arrangements, so a correct reading cannot
be a guess.

| Step | Result |
|---|---|
| Server can emit a non-text content block | **Yes.** `toolResult` gained a `RawContent` escape hatch; everything else keeps the text+structured shape |
| Wire format is correct | **Yes.** Response carries `['text','image']`, `mimeType: image/png`, 1536 base64 chars |
| The test image is legible and unambiguous | **Yes.** Read independently and matched the sealed answer exactly — `[0,0,1, 0,0,0, 0,1,1]` |
| A connected client passes the image to the model | **YES — verified 2026-08-24.** A fresh chat read the grid back exactly: `[0,0,1, 0,0,0, 0,1,1]`. 1 in 512, so not a guess |

**Incidental finding, operationally relevant:** a newly added tool is invisible
to an already-connected session. The client resolves the tool list at connect
time and does not refresh, so any new tool needs the chat restarted before it
appears. Worth knowing before shipping Phase 1 — the queue is useless if the
model cannot see `get_pending_captures` until a reconnect.

**Outcome: the image path works.** US-1.2 proceeds as designed, and in-chat
macro visualisation becomes feasible on the same mechanism.

One caveat on attribution: the tool was invisible to a client until *two* things
changed together — it gained a non-empty `inputSchema`, and the connector was
toggled off and on. Both were changed at once, so which fixed it is unproven.
The safe practice is both: give every tool at least one property, and expect a
reconnect before a new tool appears.

The answer key was `[0,0,1, 0,0,0, 0,1,1]` — top row empty/empty/filled, middle
row all empty, bottom row empty/filled/filled. If a fresh chat reports that, the
image path works and US-1.2 proceeds as designed. If it reports seeing no image,
the fallback is a short-lived signed URL; if that also fails, US-1.2 becomes
text-capture only and Phases 1 and 4 are unaffected.

### Phase 0 — original spike definition

Prove the client shows an image from a tool result before designing around it.
Add a temporary tool returning a hard-coded small JPEG as an `image` content
block; ask the model in a chat what it sees. If it cannot see it, fall back to
returning a short-lived signed URL to the object and let the client fetch it —
and if neither works, US-1.2 becomes text-capture only and the plan shrinks.

This mirrors Phase 0 of the original roadmap: find out in an afternoon rather
than after a data model.

### Migration — `0003_captures.sql`

```sql
CREATE TABLE captures (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  local_date  TEXT NOT NULL,      -- the day it belongs to, computed on write
  kind        TEXT NOT NULL,      -- photo | note
  note        TEXT,               -- what the user typed, verbatim
  object_key  TEXT,               -- R2 key, null for a note-only capture
  mime_type   TEXT,
  bytes       INTEGER,
  state       TEXT NOT NULL,      -- pending | logged | unusable
  meal_id     TEXT REFERENCES meals(id),  -- set when it becomes a meal
  resolved_at TEXT
);
CREATE INDEX idx_captures_pending ON captures(user_id, state) WHERE state = 'pending';
```

> **Shipped with one correction.** `captures.meal_id` is deliberately NOT a
> foreign key. As first written it referenced `meals(id)` while `meals.capture_id`
> referenced `captures(id)` — a cycle SQLite cannot resolve, so `DELETE` failed
> on both tables with `FOREIGN KEY constraint failed`. That would have broken
> `restore.mjs --replace`, which is the only undo this project has. Caught by a
> smoke run against a database that would not clear. The meal→capture direction
> carries the provenance and is the one worth enforcing.

Additive; nothing existing changes. The partial index exists because
`get_pending_captures` is called at the start of many conversations and must not
scan.

### Queries — `src/db/queries.ts`

`insertCapture`, `listPendingCaptures`, `resolveCapture(id, mealId | 'unusable')`.
One owner each, mirroring the existing helpers.

### Domain — `src/domain/mealtimes.ts` (US-1.4)

Pure, unit-testable, no D1: given meals over N days and the current local time,
return the next likely meal slot — `{ meal_type, typical_time, confidence }` —
computed from the user's own history by weekday. Returns **data, not advice**:
"you usually eat lunch around 12:40" is a fact; "have the chicken" is not, and
belongs in the Skill.

### Tools

| Tool | Purpose | Notes |
|---|---|---|
| `get_pending_captures` | Return unanalyzed captures, newest first | Image content block per Phase 0's finding. Description must say: estimate and call `log_meal`, then `resolve_capture` in the same turn |
| `resolve_capture` | Mark a capture `logged` (with `meal_id`) or `unusable` | Separate from `log_meal` so a capture that is genuinely unreadable can be closed without inventing a number |
| `get_next_meal` | The mealtimes shaping plus remaining macros | Facts only |

`log_meal` gains an optional `capture_id`, so a photo-derived meal is traceable
back to its evidence. `source` stays `estimate` — a photo is not a measurement.

### View — `src/app/`

- **Add-a-meal card** at the top of the day, `APP_EDIT_SECRET` only: a file
  input (`accept="image/*" capture="environment"` — opens the camera on a
  phone) and a free-text note. Plain multipart form POST to
  `/app/<secret>/capture`; no client JavaScript, consistent with the rest.
- **Pending strip**: "2 captures waiting for your coach" (US-1.13). Visible in
  read-only too, since a silently stuck queue is the failure mode.
- **Next meal** (US-1.4): "Lunch, usually around 12:40 · 1,850 kcal and 120 g
  protein left." Pure data, so the page can render it with no model.

### Skill — `skill/SKILL.md`

Tool discipline gains: at the start of any session, if `get_today` reports
pending captures, offer to work through them before anything else; estimate from
the photo, call `log_meal`, then `resolve_capture` in the same turn; if the
photo is unreadable, say so and mark it `unusable` rather than guessing.

A tool nothing tells the model to call is a tool that does not exist.

---

## 6. Phasing

| Phase | Ships | Depends on | Risk | Verification |
|---|---|---|---|---|
| 0 | Image-in-tool-result spike | — | Structural | A chat describes the test image |
| 1 | `captures` table, text-note capture, pending strip, `get_pending_captures`, `resolve_capture` | 0 | Structural | Note captured in the app appears in the model's queue and logs |
| 2 | Photo upload to R2, size and count caps, 30-day prune | 1 | Structural | Photo → meal end to end |
| 3 | `get_next_meal` + next-meal line in the view | — (independent) | Mechanical | Deterministic unit tests on `mealtimes.ts` |
| 4 | Staples and fresh list; "what can I make" over recipes + staples + remaining macros | 1, §7 decision | Structural | List edited in the app changes what `list_recipes` filtering returns |

Phase 1 unblocks the most: it establishes the queue that photos, and later any
other capture source, flow through. **Phase 3 is independent of all of it** and
is the cheapest visible win — worth shipping first if the spike stalls.

---

## 7. Pantry, takeout, restaurants — recommendation

The request asks whether a pantry connector is worth it. Honest answer: **a
pantry *inventory* is the single most reliably abandoned feature in cooking
apps, and I would not build one.**

Three reasons, in order of severity:

1. **Inventory decays instantly.** You use half an onion and do not tell the
   app. Within a week the state is wrong, and wrong inventory is worse than
   none — it produces suggestions for food you do not have.
2. **Adherence to manual entry is near zero**, and this project's whole thesis
   is that friction is what kills tracking.
3. **Receipt scanning does not fix it.** It tells you what you *bought*, never
   what you *consumed*, so the error only ever accumulates.

**Recommended instead — two lists, not an inventory:**

- **Staples**: the twenty things you always have. Changes a few times a year.
- **Fresh right now**: five to ten items, editable in ten seconds on the app's
  existing edit surface. Deliberately lossy and deliberately small.

That is enough to answer "what can I make tonight that fits my remaining
macros?" against the recipe catalog, which is the actual question. It costs one
small table and a text field, versus a whole inventory subsystem.

**Favorite takeout: yes, cheaply.** A named place plus the dishes you order is
just `portion_memory` with a label — and portion memory already solves the hard
part. Correct "the usual from Sushi X" once and it is right forever.

**Nearby restaurant discovery: defer.** It needs a places API (a new bill and a
new key, against the standing constraint of reusing what we have), and
restaurant macros are mostly unknowable, so it would produce confident numbers
with no evidence behind them — the exact failure mode the `source` and
`confidence` columns exist to prevent.

---

## 8. Risks and open decisions

**Risks**

| Risk | Mitigation |
|---|---|
| The client will not render tool-result images | Phase 0 is the whole point. Fallback: signed URL, then text-only |
| Photos in R2 are personal data in a way the log is not | Own bucket, private, no public URL, 30-day prune, and no photo ever referenced from the shareable read link |
| Upload abuse fills the bucket | Per-file cap (~5 MB) and a per-day count cap, enforced before the R2 write |
| Captures pile up unanalyzed | Pending strip in the view; the Skill checks on session start |
| A capture logs twice | `resolve_capture` in the same turn; `state` is checked, not assumed |

**Open decisions**

1. **Async analysis acceptable?** (D-1) — **DECIDED: yes**, capture-then-analyze.
   The app never calls a provider; no API keys are ever held.
2. **Should the shareable read link show pending photos?** Recommend no; show
   only the count. Still open, decided at Phase 2.
3. **Ship Phase 3 first?** — **DECIDED: yes.** Shipped 2026-08-23.
4. **Pantry shape?** — **DECIDED: two lists** (staples + fresh right now), not
   an inventory. Per §7.

---

## 9. Verification

- **Phase 0**: a chat correctly describes the test image returned by the spike tool.
- **Phase 1**: capture a note in the app → `SELECT state, note FROM captures`
  shows `pending` → `get_pending_captures` returns it → `log_meal` +
  `resolve_capture` → row is `logged` with a real `meal_id`, and the meal appears
  in `get_today`.
- **Phase 2**: photo posted from a phone-sized viewport → object exists in R2 →
  the model logs it → object pruned after retention.
- **Phase 3**: unit tests on `mealtimes.ts` — a week of 12:30 lunches yields a
  12:30 lunch prediction; an empty history yields `null`, not a guess.
- **Negative, every phase**: `APP_VIEW_SECRET` POSTing to `/capture` returns
  403; an oversized upload is rejected before the R2 write.
- **Standing**: `npm run typecheck`, `npm test`, `npm run smoke` against a
  cleared local D1, and `POST /backup/<secret>` before any prod migration.
