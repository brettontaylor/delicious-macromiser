# UI map — pages, wireframes, and the public sitemap

**Date:** 2026-08-24 · **Status:** LIVING — update alongside `apps/server/src/app/`
**Related:** [user-stories.md](plans/user-stories.md) · [ROADMAP.md](ROADMAP.md) ·
[ARCHITECTURE.md](ARCHITECTURE.md)

Two things live here. **§2–4** are the *real* app: what renders today, drawn to
scale, plus the roadmap surfaces as they will appear. **§5** is a design artifact
only — a public marketing site that does not exist and is gated behind Phase 4.
No route in §5 is built, and none should be built before OAuth.

Wireframes are drawn at the shell's real width (`layout.ts:36` — `max-width:460px`,
mobile-first, one-handed). Every glyph below maps to a class in
`apps/server/src/app/layout.ts`.

```
Legend   ████  filled / active        ····  disabled placeholder (roadmap stub)
         ────  rule or track          [ ]   control
         ░░░░  read-only region       ◆     capability-gated (edit secret only)
```

---

## 1. Route table — what exists

| Route | Method | Capability | Renderer | Status |
|---|---|---|---|---|
| `/health` | GET | none | `index.ts:69` | live |
| `/mcp/<MCP_PATH_SECRET>` | POST/DELETE | connector | `mcp/server.ts` | live |
| `/backup/<MCP_PATH_SECRET>` | POST | connector | `backup.ts` | live |
| `/app/<secret>` | GET | view or edit | `app/page.ts:82` | live |
| `/app/<secret>?date=` | GET | view or edit | `app/page.ts:87-89` | live |
| `/app/<secret>/recipes` | GET | view or edit | `app/recipes.ts` | live |
| `/app/<secret>/capture` | POST | **edit only** | `app/write.ts` | live |
| `/app/<secret>/save` | POST | **edit only** | `app/write.ts` | live |
| `/app/<secret>/remove` | POST | **edit only** | `app/write.ts` | live |
| `/app/<secret>/roadmap` | GET | view or edit | `app/roadmap.ts` | **new — this change** |

Three secrets, three capabilities, resolved server-side from the path
(`index.ts:94-102`). Nothing in §5 changes that; a public site would need its own
unauthenticated origin and its own reason to exist.

---

## 2. `/app/<secret>` — the day view (live)

The primary surface. Everything a user opens the app for is above the fold on a
phone: what today is *for*, what is left, and what to do next.

```
┌────────────────────────────────────────────┐
│ Macromiser          Recipes ·  Plan  ░READ░│  .bar / .navlink / .ro
├────────────────────────────────────────────┤
│                                            │
│ August 23, 2026                            │  h1.date
│ Today · 5 meals logged                     │  .sub
│                                            │
│ (08-23)(08-22)(08-21)(08-20)(08-19) →      │  nav.days — only days with entries
│                                            │
│ ┃ Rest day                                 │  section.today  (border-left 3px)
│ ┃ walk 10,000 steps, no cell phone time,   │  .t-notes — the user's OWN words
│ ┃ no alcohol                               │
│ ┃ Next lift Tuesday — Lower body           │  .t-next
│                                            │
│           ╭──────────────────╮             │  .gauge — 320×176 SVG half-arc
│        ╭──┘   ████████████   └──╮          │  .arc-f .lit (accent glow)
│      ╭─┘  ████            ████  └─╮        │
│                Calories                    │  .g-label
│                  2210                      │  .g-value  52px display
│              / 2300 kcal                   │  .g-goal
│              90 remaining                  │  .g-left
│                                            │
│ ┌────────────────────────────────────────┐ │  .upnext
│ │ Dinner   usually around 7:10pm         │ │
│ │                       90 kcal · 0g left│ │  .up-budget
│ └────────────────────────────────────────┘ │
│                                            │
│   Protein        Carbs          Fat        │  .macros — 3-col grid
│   191/170g       138/235g       95/75g     │  .m-num  tabular-nums
│   ██████████     ██████░░░░     ██████████ │  .bar-t
│                                            │
│ ┌────────────────────────────────────────┐ │  ◆ .capture — edit secret only
│ │ Log a meal                             │ │
│ │ [ 8oz chicken, cup of rice, big salad ]│ │
│ │ [        ＋ Add a photo               ]│ │  file input, capture="environment"
│ │ [            Capture                  ]│ │
│ │ The app does no analysis of its own —  │ │  .hint — states the BYO-LLM contract
│ │ your coach reads this next chat.       │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ ▓2▓ waiting for your coach                 │  .pending — accent fill, only when >0
│     grilled salmon · protein bar           │  .pend-list — notes inline
│                                            │
│ Meals                        2210 kcal     │  .head
│ ┌────────────────────────────────────────┐ │  .card
│ │ Protein shake — 7g fat, 13g carbs…     │ │
│ │ (breakfast)(import)(high confidence)   │ │  .chip
│ │ 200 kcal   P 18   C 13   F 7    [Edit] │ │  ◆ <details> opens inline form
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ Mixed middle eastern grill chicken…    │ │
│ │ (dinner)(estimate)(low confidence)     │ │
│ │ 1150 kcal  P 91   C 78   F 54   [Edit] │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ Training                     last 30 days  │
│ ┌────────────────────────────────────────┐ │
│ │ 2026-08-22 · Lower body                │ │
│ │ [back squat 205×6][bench 135×10]…      │ │  .set — mono, tabular
│ └────────────────────────────────────────┘ │
│                                            │
│ Bodyweight              no readings · 190  │
│ ┌────────────────────────────────────────┐ │  chart.ts — inline SVG, no library
│ │        ·  ·                            │ │  .c-dot   raw weigh-ins (faint)
│ │     ·      ╲___                        │ │  .c-avg   7-day rolling (the line)
│ │              ╲____·                    │ │
│ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ target 190 ─ ─ ─ │ │  .c-target dashed
│ └────────────────────────────────────────┘ │
│                                            │
│ ────────────────────────────────────────── │
│ Editing here marks an entry corrected…     │  footer
└────────────────────────────────────────────┘
```

### The same page, with roadmap stubs in place

Placeholders sit **where the feature will live**, not in a separate backlog.
Rendered `····`, non-interactive, each linking to its row on `/roadmap`. They are
suppressed entirely on the read-only capability — a shared link should show a
finished product, not a construction site.

```
│ ┃ Rest day                                 │
│ ┃ walk 10,000 steps, no cell phone time…   │
│ ┃ Next lift Tuesday — Lower body           │
│ ┌ · · · · · · · · · · · · · · · · · · · ·┐ │  ← E1 stub  (prescribed session)
│ ·  Today's session            Planned  ·   │     the block's Day A, with loads
│ ·  Back squat 4×6 @ 185 · RDL 3×8 @ 135 ·  │
│ └ · · · · · · · · · · · · · · · · · · · ·┘ │
│                                            │
│           ╭──────────────────╮             │
│        ╭──┘   ████████████   └──╮          │
│                  2210                      │
│              / 2300 kcal                   │
│ ┌ · · · · · · · · · · · · · · · · · · · ·┐ │  ← E3 stub  (weekly budget)
│ ·  Week  11,240 / 16,100      Planned  ·   │     the framing the coach teaches
│ ·  ████████████░░░░░░  3 days left      ·  │
│ └ · · · · · · · · · · · · · · · · · · · ·┘ │
│                                            │
│   Protein        Carbs          Fat        │
│   191/170g       138/235g       95/75g     │
│ ┌ · · · · · · · · · · · · · · · · · · · ·┐ │  ← E6 stub  (pacing)
│ ·  100g protein by 2pm — best pace yet  ·  │     meals.logged_at, already stored
│ └ · · · · · · · · · · · · · · · · · · · ·┘ │
│                                            │
│ ┌ · · · · · · · · · · · · · · · · · · · ·┐ │  ← E5 stub  (daily adherence)
│ ·  Today's commitments         Planned  ·  │
│ ·  [ ] 10,000 steps   [ ] no alcohol    ·  │     from training_plan.notes
│ ·  [ ] creatine 5g                      ·  │     from the supplement stack
│ └ · · · · · · · · · · · · · · · · · · · ·┘ │
│                                            │
│ Bodyweight              no readings · 190  │
│ ┌────────────────────────────────────────┐ │
│ │        ·  ·      ┊                     │ │  ← E2 stub  (event marker)
│ │     ·      ╲___  ┊                     │ │     vertical rule + label
│ │              ╲___┊_·                   │ │
│ │                  ┊ creatine started    │ │     "disregard 3 weeks of scale"
│ └────────────────────────────────────────┘ │
```

---

## 3. `/app/<secret>/recipes` — the book (live)

```
┌────────────────────────────────────────────┐
│ Macromiser              Today  ·  ░READ░   │
├────────────────────────────────────────────┤
│ Recipes                                    │
│ 6 dishes · sorted by tonight's budget      │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │ Galbi jjim                             │ │
│ │ 612 kcal · P 48 · C 31 · F 29 /serving │ │
│ │ (fits tonight)(have 9 of 11)           │ │
│ │ ▸ Missing: gochujang, Asian pear       │ │  <details> — the shopping gap
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ Spicy heritage chicken ragù            │ │
│ │ 540 kcal · P 41 · C 44 · F 20 /serving │ │
│ │ (have 11 of 11)                        │ │
│ └────────────────────────────────────────┘ │
│ ┌ · · · · · · · · · · · · · · · · · · · ·┐ │  ← S-27 stub (shopping list)
│ ·  Build a shopping list       Planned  ·  │
│ └ · · · · · · · · · · · · · · · · · · · ·┘ │
└────────────────────────────────────────────┘
```

---

## 4. `/app/<secret>/roadmap` — the in-app roadmap (new)

One page, the whole plan, ordered as [ROADMAP.md](ROADMAP.md) orders it. Its
purpose is that the inline stubs have somewhere to point, and that the operator
can see the build state from a phone without a terminal.

```
┌────────────────────────────────────────────┐
│ Macromiser        Today · Recipes  ░READ░  │
├────────────────────────────────────────────┤
│ Roadmap                                    │
│ 8 shipped · 6 planned · 2 gated            │
│                                            │
│ ─── Shipped ─────────────────────────────  │
│ ✓ Photo capture                    Aug 24  │  .r-done
│ ✓ The capture queue                Aug 24  │
│ ✓ Next-meal prediction             Aug 24  │
│ ✓ One-call briefing                Aug 24  │
│ ✓ The pantry                       Aug 24  │
│ ✓ Recipes in the app               Aug 23  │
│ ✓ Training plan                    Aug 23  │
│ ✓ Correction UI + trends           Aug 23  │
│                                            │
│ ─── Next ────────────────────────────────  │
│ ┌────────────────────────────────────────┐ │
│ │ 1  Events & annotations                │ │  .r-next — numbered, ordered
│ │    Mark creatine, travel, injury on    │ │
│ │    the trend so the scale reads true.  │ │
│ │    (E2)(S-15)(one evening)             │ │  .chip
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ 2  Pacing & milestones                 │ │
│ │    "100g by 2pm — best pace yet."      │ │
│ │    (E6)(S-12, S-23)(one evening)       │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ 3  Prescribed session & block          │ │
│ │    Today's session with real loads,    │ │
│ │    written down before you go.         │ │
│ │    (E1)(S-5, S-6, S-7)(the epic)       │ │
│ └────────────────────────────────────────┘ │
│ │ 4  Weekly budget                       │ │
│ │ 5  Supplements & standing rules        │ │
│ │ 6  Athlete profile & onboarding        │ │
│                                            │
│ ─── Gated ───────────────────────────────  │
│ ○ Apple Health / Whoop      needs OAuth    │  .r-gated — muted, reason stated
│ ○ Multi-user                needs a 2nd    │
│                                            │
│ ────────────────────────────────────────── │
│ Planned items appear greyed in place       │
│ throughout the app.                        │
└────────────────────────────────────────────┘
```

---

## 5. Public site — **design artifact only, not built**

No route below exists. Nothing here should be implemented before Phase 4
(OAuth + per-user isolation), for one reason: every current route is
`noindex, no-store, no-referrer` (`layout.ts:196-202`) because the URL *is* the
credential. A public origin has the opposite requirements, and mixing the two on
one Worker is how a shared read link ends up in a search index.

This exists so today's naming and information architecture do not paint us into
a corner.

```
macromiser.app/
│
├── /                                   Landing — the thesis, in one screen
│   ├── hero                            "Your coach forgets. This doesn't."
│   ├── the-problem                     ← PRODUCT.md §1 failure table
│   ├── how-it-works                    3 steps: connect · talk · it remembers
│   ├── bring-your-own-model            the differentiator: your subscription,
│   │                                     your tokens, no API key ever held
│   └── cta                             Connect to Claude
│
├── /how-it-works/
│   ├── /connect                        adding the custom connector, per client
│   ├── /the-coaching-layer             why judgement is a text file, not code
│   └── /what-it-stores                 the data model in plain language
│
├── /recipes/                           ← PUBLIC. The book is not sensitive.
│   ├── /                               grid, filterable
│   ├── /:slug                          one card, print-ready, JSON-LD intact
│   └── /nutrition                      how per-serving macros are derived
│                                         (Atwater cross-check, x-components)
│
├── /product/
│   ├── /training                       get_last_performance, the block, loads
│   ├── /nutrition                      logging, corrections, the weekly budget
│   └── /roadmap                        ← public mirror of §4, sourced from the
│                                         SAME roadmap module. One source.
│
├── /trust/
│   ├── /privacy                        required before user #2 (Phase 4)
│   ├── /security                       three secrets, what each opens
│   ├── /your-data                      export and deletion path
│   └── /terms
│
├── /changelog                          generated from ROADMAP.md "shipped"
├── /docs → github.com/…                the repo is public; do not fork the docs
│
└── app.macromiser.app/                 ── SEPARATE ORIGIN, authenticated ──
    ├── /login                          OAuth 2.1 + PKCE (Phase 4)
    ├── /today                          ← today /app/<secret>
    ├── /day/:date                      ← today ?date=
    ├── /week                           E3 — the weekly budget
    ├── /session                        E1 — today's prescribed session
    ├── /program                        E1 — the block, all weeks
    ├── /body                           trends + E2 event markers
    ├── /daily                          E5 — commitments and the stack
    ├── /recipes                        ← today /app/<secret>/recipes
    ├── /pantry                         two lists, editable
    ├── /roadmap                        ← today /app/<secret>/roadmap
    ├── /profile                        E4 — the athlete profile
    └── /share                          S-25 — mint and revoke a read link
```

### Why the split origin

| Concern | Public `macromiser.app` | App `app.macromiser.app` |
|---|---|---|
| Indexing | wanted | `noindex` always |
| Caching | CDN, long TTL | `private, no-store` |
| Auth | none | OAuth 2.1 (Phase 4) |
| Content | recipes, docs, marketing | the log |

The recipe book is the only content that is genuinely both — public in `/recipes/`
and personalised in the app. It is already built to survive that: the card is the
single source of truth, `schema.org/Recipe` markup and all, and the catalog is
compiled from it at deploy (`scripts/build-recipe-catalog.mjs`).

---

## 6. Rules for adding a page

1. **Capability first.** Decide which secret opens it before writing markup.
   Read-only is the default; the write path is the exception (`index.ts:126-138`).
2. **Use the shell.** `shell()` and `PAGE_CSS` from `app/layout.ts`. Never a
   second stylesheet — that is how a design system starts drifting, and it is
   why the shell was extracted in the first place.
3. **No client JavaScript.** Plain form POSTs with Post/Redirect/Get. The whole
   view layer has no build step and should keep none.
4. **Mobile first at 460px.** It is used one-handed, in a kitchen or a gym.
5. **Every new roadmap item gets a stub** where it will live, plus a row on
   `/roadmap`. A placeholder in the wrong place is worse than none.
