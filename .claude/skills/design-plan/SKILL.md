---
name: design-plan
description: >
  Produce an implementation-ready design plan for a scoped body of work —
  grounded in the CURRENT build (real file:line references, not assumptions),
  with user stories on every side of the feature including the MODEL as an
  actor, a concrete technical approach (migration → queries → domain → tools →
  view → skill), explicit phasing, risks, and a verification plan. Use before
  implementing any multi-part feature, when converting a backlog item into a
  build plan, or when asked for "a design plan", "plan this properly", or
  "user stories for X". Ported from the D-I Wine skill of the same name and
  adapted for this stack. Distinct from /plan-review, which critiques an
  existing plan. This skill WRITES the plan.
---

# Design Plan

Turn scoped work into a plan someone could implement without re-deriving
context. The failure mode this exists to kill: plausible-sounding plans that
ignore what is already built, invent parallel patterns, and get discovered as
wrong halfway through implementation.

**Bias: verbose over terse.** Written once, implemented from many times.

---

## Step 0 — Ground in the current build (MANDATORY, first)

Never write a line of plan before reading the code it touches. Every structural
claim carries a `file:line`.

1. **Locate the spine.** For each area in scope find the existing owner: the
   migration, the query helper, the domain module, the tool, the view fragment.
   Use Grep/Glob, or an Explore agent for broad fan-out.
2. **Find the proven pattern to mirror.** This repo almost always has one:
   backdating via `resolveWhen` in `src/mcp/tools/args.ts`; shared validation in
   `src/mcp/tools/sets.ts`; bundled-not-stored reference data in
   `src/domain/recipes.ts`; capability-by-secret in `src/index.ts`. A new
   parallel pattern needs an explicit justification paragraph.
3. **Read the docs that bind**: `docs/PRODUCT.md` (objectives and explicit
   non-objectives), `docs/ARCHITECTURE.md` (the boundary), `docs/ROADMAP.md`
   (phase and exit criteria), `CLAUDE.md` (guardrails).
4. **State what you verified vs. what you assumed.** An assumption that reaches
   the plan unlabelled becomes a bug.

---

## Step 1 — User stories, every side

A feature has at least three sides here; most have four. One table per actor,
each row: **story → what the current build does → the gap.**

| Actor | Ask |
|---|---|
| **End user** | What do they experience, and what do we make them do? |
| **The model** | What does it see, and does the tool description make the right call obvious? In an MCP product the model is a first-class consumer — tool descriptions are its UI, and a bad one is a UX bug, not a docs bug. |
| **Operator** (Brett) | What must they do to keep this correct? What breaks silently? |
| **System** (cron, connector, backup) | What runs unattended, and what happens when it fails? |

Rules:

- Ground every "current build does X" in a `file:line`. If it does nothing, say so.
- Give each story an id (US-1.2) so phases, tests and commits can cite it.
- If a story reveals the *upstream* fix differs from the requested work, say so
  explicitly — it is the highest-value thing a plan can surface.

---

## Step 2 — Conform to what already exists (name the rule, do not restate it)

**The boundary** (ARCHITECTURE.md, PRODUCT.md section 2) — the server stores,
retrieves, and does arithmetic. Judgement lives in `skill/SKILL.md`. If the plan
wants a tool that returns a recommendation, the boundary is wrong. Returning the
*data* a judgement needs is correct; returning the judgement is not.

**Evidence quality** — every meal carries `source` and `confidence`. Any new
write path must say which it produces and why. Reconstructed data must stay
distinguishable from data captured as it happened.

**Secrets and capability** (CLAUDE.md) — `MCP_PATH_SECRET` (connector),
`APP_EDIT_SECRET` (editable page), `APP_VIEW_SECRET` (shareable, read-only).
Capability is resolved from which secret opened the request. Never widen one.

**The view** — server-rendered, no framework, no client JavaScript, no build
step. Design tokens are lifted from macromiser.vercel.app so the two read as one
product; `apps/server/src/app/page.ts` holds them. Mobile-first: the page is
used one-handed in a kitchen or a gym.

**Undo** — `correct_meal` and `delete_meal` exist. Any new writable entity needs
its own answer to "how does the user take this back", or must say plainly that
it has none.

**Cost** — Cloudflare free tier; GitHub Actions free while the repo is public. A
design needing a new paid service must justify it against reusing what exists.

---

## Step 3 — Technical approach (the body)

Layer by layer, dependency order. Real names, real types, real paths.

1. **Migration** — numbered SQL in `apps/server/migrations/`. Additive and
   nullable unless there is a reason. State indexes and why. A destructive
   migration must be flagged and preceded by a backup.
2. **Queries** — the helper in `src/db/queries.ts` that owns the access. One
   owner; if two call sites need it, extract (see `tools/sets.ts` for why).
3. **Domain** — pure logic in `src/domain/`, unit-testable with no Worker and no
   D1. If it can live here, it must.
4. **Tool surface** — name, JSON Schema, and the description text. Treat the
   description as product copy: it is the only thing steering the model. State
   what it must *stop* the model doing, not only what it enables.
5. **View** — which fragment of `src/app/`, what states (empty, error), and
   which capability may see it.
6. **Skill** — what `skill/SKILL.md` must learn. A tool nothing tells the model
   to call is a tool that does not exist.

---

## Step 4 — Phasing

A table: **Phase · What ships · Depends on · Risk · Verification.**

- Each phase independently shippable and independently valuable.
- Risk: **Mechanical** · **Structural** · **Risky** · **Gated** (stop and ask).
- Name the phase that unblocks the most downstream work.
- Anything touching prod data is preceded by `POST /backup/<secret>`.

---

## Step 5 — Risks and open decisions

- **Known gotchas that apply.** Real ones: the smoke test is not idempotent;
  `import_days` is not idempotent; a `.dev.vars` written with CRLF makes the
  secret read as unset; the generated recipe catalog is gitignored so a fresh
  clone depends on `prepare`; a shared read link must never gain write
  capability.
- **New risks this design introduces**, each with a mitigation.
- **Open decisions**, numbered, each with a recommendation. Never buried.

---

## Step 6 — Verification plan

Per phase, how it is proven — and prefer proving over asserting:

- `npm run typecheck`, `npm test`, `npm run recipes:check`
- `npm run smoke` against `wrangler dev` (clear the tables first — it is not
  idempotent)
- For a view: fetch the rendered HTML and assert on content, not on a 200
- For a tool: call it over JSON-RPC and assert the stored row, not the response
- For prod: the same checks against the deployed Worker

Name the exact commands and the expected values.

---

## Output

Write to `docs/plans/<slug>.md`. Structure:

1. Header — date, status, what triggered this, related docs
2. Executive summary — 3-5 sentences including the single most important finding
3. Current-build map (Step 0)
4. User stories (Step 1)
5. Technical design (Step 3), conventions noted inline (Step 2)
6. Phasing (Step 4)
7. Risks and open decisions (Step 5)
8. Verification (Step 6)

Then in chat: a compact summary, and the open decisions as an AskUserQuestion
when they actually change what gets built.

---

## Anti-patterns

- Planning from memory of the codebase instead of reading it
- A new pattern where a proven one exists, without justification
- "We'll add a field" with no name, type, or owner
- Phases that cannot ship independently
- Burying operator decisions at the bottom in prose
- A tool that returns judgement instead of the data a judgement needs
- Writing a tool without saying what the Skill must learn about it
