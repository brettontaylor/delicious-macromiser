# Delicious Macromiser

**Recipes + Macros.** A printable recipe book and a remote MCP server for
training and nutrition — in one repo, because a recipe you actually cooked is
the most accurate food entry you will ever log.

---

## The two halves

| Half | What it is | Where |
|---|---|---|
| **Recipes** | Self-contained, print-ready 2-page HTML cards. No frameworks, no build step, no dependencies beyond Google Fonts. | [`content/recipes/`](content/recipes/) |
| **Macros** | A Cloudflare Worker exposing 8 MCP tools over D1 — meal logging, workout logging, progression history, weekly trends. | [`apps/server/`](apps/server/) |

They are not yet joined. Joining them is the next milestone: recipes gain a
`schema.org/Recipe` JSON-LD block with per-serving nutrition, and `log_meal`
learns to take a recipe slug instead of an estimate. See
[docs/ROADMAP.md](docs/ROADMAP.md) Phase 2.5.

## Why this exists

People already use chat assistants as their nutrition and strength coach. The
conversation is good; the persistence is nonexistent — no lift history, no
running daily total, no trend view, and estimates that never improve.

The thesis, in one line: **the database is commodity, the coaching loop is the
product.** The server stores and retrieves and does arithmetic. Every judgment
lives in a prompt layer ([`skill/SKILL.md`](skill/SKILL.md)) that can be edited
in a text file without a deploy.

Full reasoning: [docs/PRODUCT.md](docs/PRODUCT.md) for the problem, thesis, and
user objectives; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack and
data model.

## Layout

```
delicious-macromiser/
├── apps/server/           MCP server — Cloudflare Worker + D1
│   ├── src/               entry, MCP transport, tools, domain logic
│   ├── migrations/        numbered SQL, applied via wrangler
│   ├── seeds/             local dev seed (never applied to prod)
│   └── test/              unit tests — pure domain logic, no Worker, no D1
├── content/recipes/       the recipe book — source of truth
│   └── _template/         BASE_TEMPLATE.html + Pencil design system
├── scripts/               repo-level tooling (recipe conformance)
├── skill/                 the coaching layer — all judgment lives here
└── docs/                  architecture, roadmap, dev + deploy guide
```

## Commands

```bash
npm install              # workspace install
npm run typecheck        # tsc --noEmit on the server
npm test                 # 27 unit tests, no network
npm run recipes:check    # recipe format conformance
npm run dev              # wrangler dev on :8787
npm run smoke            # 51-check end-to-end MCP test against a running server
```

Deploying and connecting to Claude: [docs/DEV.md](docs/DEV.md).

## Adding a recipe

Read [`content/recipes/RECIPE_FORMAT.md`](content/recipes/RECIPE_FORMAT.md) and
[`content/recipes/_template/BASE_TEMPLATE.html`](content/recipes/_template/BASE_TEMPLATE.html)
in full, then write a single `.html` file into `content/recipes/`. Run
`npm run recipes:check` before committing.

## A note on what is public

This repo is public. The code is generic and the recipes are just recipes — the
actual training and nutrition log lives in Cloudflare D1 and is never committed.
The v1 server is authless by design: a 256-bit path secret in the URL is the
credential, held in `wrangler secret`, never in git.
