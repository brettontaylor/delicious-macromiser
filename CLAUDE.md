# Delicious Macromiser — project instructions

**Recipes + Macros.** Two halves in one repo: a printable recipe book
(`content/recipes/`) and an MCP server for training + nutrition
(`apps/server/`). Public repo — see "Guardrails" below.

---

## Structure

npm workspaces. One app today (`@dm/server`); `apps/web` is reserved for the
recipe UI in roadmap Phase 5. Run everything from the repo root.

| Path | What |
|---|---|
| `apps/server/` | Cloudflare Worker, 8 MCP tools over D1. Stateless — no session objects |
| `content/recipes/` | Recipe HTML cards, the format spec, and the base template |
| `apps/server/src/app/` | The read-only web view at `/app/<view secret>` |
| `scripts/check-recipes.mjs` | Recipe conformance — dependency-free on purpose |
| `skill/SKILL.md` | The coaching layer. Every judgment lives here, not in code |
| `docs/` | ARCHITECTURE, ROADMAP, COACHING-LAYER, DEV |

## Commands

```bash
npm run typecheck        # tsc --noEmit
npm test                 # 27 unit tests
npm run recipes:check    # recipe format conformance
npm run dev              # wrangler dev on :8787
npm run smoke            # 51-check E2E against a running server
npm run deploy:prod      # manual, deliberately not in CI
```

## Guardrails

- **Never commit secrets.** `MCP_PATH_SECRET` and `APP_VIEW_SECRET` are the
  entire authentication story for v1 — both live in `wrangler secret` and
  `.dev.vars` (gitignored). The repo is public.
- **Keep the three secrets apart.** `MCP_PATH_SECRET` is the connector,
  `APP_EDIT_SECRET` opens the editable page, `APP_VIEW_SECRET` opens the
  read-only one and is the only one safe to share. Never reuse one for another,
  and never hand out the MCP URL.
- **Never put log data in the repo.** Meals, workouts, and bodyweight live in
  D1. `seeds/dev_seed.sql` is local-only and must never be applied to prod — it
  is deliberately outside `migrations/` so `d1 migrations apply` cannot reach it.
- **The server stays dumb.** Storage, retrieval, arithmetic. No coaching
  opinions in `apps/server/`. If a rule would change weekly, it belongs in
  `skill/SKILL.md`.
- **The smoke test is not idempotent.** Several assertions assume an empty log.
  Clear the tables before re-running (see `docs/DEV.md`).
- **No deploy job in CI.** The prod server holds a live log; deploys are manual.

## Adding a recipe

Read `content/recipes/RECIPE_FORMAT.md` and
`content/recipes/_template/BASE_TEMPLATE.html` fully before writing any code.
Output one self-contained `.html` into `content/recipes/`. Rules:

1. Two pages max — page 1 the main dish, page 2 sides + plating
2. All CSS inline; Google Fonts is the only permitted external origin
3. Use the template's CSS variables — do not invent colors
4. Every card needs: ingredients, numbered steps, chef's note, meta row, footer
5. Run `npm run recipes:check` before committing

## Planning workflow

Ported from D-I Wine and adapted for this stack. Plans live in `docs/plans/`.

| Skill | Use |
|---|---|
| `/design-plan` | Writes an implementation-ready plan: user stories on every side (including **the model** as an actor), technical design layer by layer, phasing, risks, verification |
| `/plan-review` | Critiques a plan before implementation. Does not edit code |
| `/verify` | Proves a feature works against a running server. Evidence, not assertions |

The model is a first-class actor in every user-story table. In an MCP product a
tool description *is* the model's UI, so a bad one is a UX bug, not a docs bug.

## Where this is going

The two halves join in Phase 2.5: recipes gain `schema.org/Recipe` JSON-LD with
per-serving nutrition, a build step compiles them into a catalog the Worker
bundles, and `log_meal` accepts a recipe slug. That turns the recipe book into
the highest-confidence source of food entries in the log. See `docs/ROADMAP.md`.
