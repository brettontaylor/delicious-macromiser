# Macromiser — running it

Phase 0 and Phase 1 of [ROADMAP.md](ROADMAP.md), built together. The server is
stateless: eight tools over Streamable HTTP against D1, no session objects.

---

## 1. Local, in about two minutes

This is an npm-workspaces repo. Run `npm` from the **repo root** — the root
scripts delegate to the `@dm/server` workspace. Only the D1 and wrangler
commands need to run from `apps/server/`, because that is where `wrangler.toml`
lives.

```bash
npm install                             # from the repo root
cd apps/server
cp .dev.vars.example .dev.vars          # then edit the secret if you like
npm run db:migrate:local
npm run db:seed:local                   # optional: a user + starter goals
cd ../..
npm run dev                             # http://127.0.0.1:8787
```

In a second terminal:

```bash
npm run smoke
```

That drives the whole MCP handshake plus all four Phase 1 exit criteria as real
tool calls. Read its output before you touch the connector UI — a failure here
is much cheaper to diagnose than a failure inside claude.ai.

Unit tests (pure domain logic, no Worker, no D1):

```bash
npm test
npm run typecheck
```

---

## 2. Deploying

All of these run from `apps/server/`, where `wrangler.toml` lives.

```bash
# Authenticate once (opens a browser OAuth grant)
npx wrangler login

# One-time
npx wrangler d1 create macromiser          # paste database_id into wrangler.toml
npx wrangler d1 create macromiser-prod     # paste into [[env.prod.d1_databases]]

# Generate a path secret and store it (never commit it)
node -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"
npx wrangler secret put MCP_PATH_SECRET --env prod

npm run db:migrate:prod
npm run deploy:prod
```

> `db:migrate:prod` passes `macromiser-prod`, not `macromiser`. Under
> `--env prod` wrangler resolves the D1 by the name in `[[env.prod.d1_databases]]`,
> so the dev database name is not found there.

Verify, then smoke-test the deployed server:

```bash
curl https://macromiser-prod.<subdomain>.workers.dev/health
node scripts/smoke.mjs https://macromiser-prod.<subdomain>.workers.dev <secret>
```

> The smoke test writes real rows, and it is **not idempotent** — several
> assertions ("one session is not enough to progress", the bodyweight rolling
> average) depend on starting from an empty log. Run it against prod once, then
> delete the rows it made, or point it at a throwaway D1. Locally, clear the log
> tables before re-running:
>
> ```bash
> npx wrangler d1 execute macromiser --local --command "DELETE FROM sets; DELETE FROM workouts; DELETE FROM meals; DELETE FROM bodyweight; DELETE FROM portion_memory;"
> ```

---

## 2b. The web view

`/app/<secret>` serves a server-rendered day view — the ring, macros, meals with
their source and confidence, recent sessions, and a bodyweight trend chart. No
framework, no build step, no client JavaScript.

**Three secrets, three capabilities**, each revocable without touching the others:

| Secret | Opens | Can write |
|---|---|---|
| `MCP_PATH_SECRET` | the connector at `/mcp/<secret>` | yes, via tools |
| `APP_EDIT_SECRET` | `/app/<secret>`, editable | yes, this page only |
| `APP_VIEW_SECRET` | `/app/<secret>`, read-only | no |

```bash
npx wrangler secret put APP_VIEW_SECRET --env prod
npx wrangler secret put APP_EDIT_SECRET --env prod
```

The read link exists to be shared, so editing must not ride along with it — the
capability is resolved from which secret opened the page, and a read link that
reaches a write path gets 403, not a silent no-op. An unset secret disables that
capability rather than opening it; a wrong secret and an unconfigured one both
return the same 404 so the response never distinguishes them.

Editing is plain HTML form POSTs with Post/Redirect/Get — no fetch, no client
state that can disagree with the server, and a refresh after saving never
re-submits. An edit made with a thumb and one made in chat are indistinguishable
in the log: both land as `source='corrected'` and both teach a portion.

---

## 2c. Backups

A nightly cron on the prod Worker dumps every table to R2 as one JSON object,
keyed by date, keeping 30 days. `wrangler d1 export` is a CLI command and cannot
run inside a Worker, so this reads the tables directly — which also means a
snapshot is a plain object you can inspect without SQLite.

```
[env.prod.triggers]  crons = ["10 7 * * *"]     # after midnight in every US tz
[[env.prod.r2_buckets]] binding = "BACKUPS"      # bucket: macromiser-backups
```

Take one on demand (gated on the **write** secret — a snapshot is an operational
action, so the shareable view secret cannot trigger it):

```bash
curl -X POST https://macromiser-prod.<subdomain>.workers.dev/backup/<MCP_PATH_SECRET>
```

### Restoring

D1 has no point-in-time restore on the free tier, and there are no edit or delete
tools yet, so this is currently the only undo that exists.

```bash
npx wrangler r2 object get macromiser-backups/d1/2026-08-23.json --file=bk.json --remote
npm run backup:restore -- bk.json --replace > restore.sql   # read it before running
npx wrangler d1 execute macromiser-prod --remote --env prod --file=restore.sql
```

The script only prints SQL — it never touches a database. Restoring is rare,
high-stakes and irreversible; you should read the statements first, and a script
that helpfully applied them would remove that step.

Without `--replace` it only inserts. With it, every table is emptied first —
correct after a bad write, wrong if the live database holds good rows the
snapshot predates.

> Verified end-to-end: a production snapshot (21 meals, 52 sets, 3 workouts)
> restored into an empty local D1 and reproduced those counts exactly.

---

## 3. Connecting it to Claude

Custom connectors require Pro/Max/Team/Enterprise, and must be **added on
claude.ai web** — mobile inherits the connector but cannot add one.

1. claude.ai → Settings → **Customize** → Connectors → **Add custom connector**
2. URL: `https://macromiser-prod.<subdomain>.workers.dev/mcp/<secret>`
3. No auth (v1 is authless — the URL *is* the credential)
4. Start a chat, confirm the tools appear, then check Claude mobile

Then install the coaching layer, which is where all judgment lives:

- [skill/SKILL.md](../skill/SKILL.md) → install as a Claude Skill, or paste into
  Project instructions
- Put the per-user profile block (bodyweight, targets, split, constraints) in
  **Project instructions**, not the Skill, so the Skill stays portable

**Phase 0 exit:** Claude on your phone can call a tool on your Worker.
**Phase 1 exit:** the four criteria in [ROADMAP.md](ROADMAP.md) — all four are
asserted by `scripts/smoke.mjs`.

---

## 4. What is built

| Layer | Files | Notes |
|---|---|---|
| Worker entry, routing, identity | [src/index.ts](../apps/server/src/index.ts) | Path secret compared in constant time; identity derived server-side, never from tool args |
| MCP transport | [src/mcp/rpc.ts](../apps/server/src/mcp/rpc.ts) | Stateless Streamable HTTP + JSON-RPC 2.0 |
| Method dispatch | [src/mcp/server.ts](../apps/server/src/mcp/server.ts) | `initialize`, `tools/list`, `tools/call`, `ping` |
| Tool descriptions | [src/mcp/descriptions.ts](../apps/server/src/mcp/descriptions.ts) | Product copy. The highest-leverage file here |
| Tools | [src/mcp/tools/](../apps/server/src/mcp/tools/) | 8 tools, one file each |
| Arg validation | [src/mcp/tools/args.ts](../apps/server/src/mcp/tools/args.ts) | Bad input raises; it never becomes a 0 |
| Aggregation | [src/domain/totals.ts](../apps/server/src/domain/totals.ts) | Alcohol separation, day/week totals |
| Progression shaping | [src/domain/progression.ts](../apps/server/src/domain/progression.ts) | Data for `get_last_performance`. No advice |
| Exercise normalization | [src/domain/exercise.ts](../apps/server/src/domain/exercise.ts) | "squats" and "Back Squat" → one history |
| Timezone | [src/util/date.ts](../apps/server/src/util/date.ts) | `local_date` computed on write |
| Schema | [migrations/0001_init.sql](../apps/server/migrations/0001_init.sql) | Matches ARCHITECTURE.md §4 |
| Coaching layer | [skill/SKILL.md](../skill/SKILL.md) | Every judgment |

Eight tools, not the ten in ARCHITECTURE.md §5. `update_entry` and
`delete_entry` are deferred to Phase 3, where they belong with the correction
UI that gives them a purpose.

---

## 5. One deliberate deviation from ARCHITECTURE.md

**§2 says "Official MCP TypeScript SDK."** The transport here is hand-rolled
(~90 lines in [src/mcp/rpc.ts](../apps/server/src/mcp/rpc.ts)).

The reason: the SDK's `StreamableHTTPServerTransport` is written against Node's
`IncomingMessage`/`ServerResponse`, which do not exist in Workers. Cloudflare's
supported path is `McpAgent`, which requires a Durable Object per session. This
server is stateless — every tool call is a self-contained read or write against
D1 — so a session object adds a moving part and buys nothing.

Tool registration keeps the SDK's shape (name / description / JSON Schema), so
switching later is a transport swap rather than a rewrite. The point to revisit
it is the first time the server needs to *initiate* a message — sampling,
elicitation, or progress notifications. None of Phases 1–3 do.

Protocol versions are pinned to what SDK 1.30.0 supports: latest `2025-11-25`,
falling back to `2025-06-18` for an unrecognized request.

---

## 6. Now stop

ROADMAP.md is right: **use it for two weeks before writing more code.** Several
schema decisions here are hypotheses, and two weeks of real logging will
invalidate some of them cheaply.

The one thing worth doing in the meantime is iterating
[skill/SKILL.md](../skill/SKILL.md) — it is a text file, not a deploy, and it will
be more valuable than the server within a month.
