---
name: ship
description: |
  Deploy macromiser to production: checks, push, backup, migrate, deploy, prove
  it. Ported from the D-I Wine skill of the same name and INVERTED — there,
  push IS deploy because Railway watches main. Here push is the cheap half and
  deploy is the risky half, because the prod Worker holds a live training and
  nutrition log. Use when the user says /ship, "deploy this", or "put it live".
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# Ship: deploy to a server that holds real data

**The one sentence that makes this skill different from its D-I Wine parent:
pushing to `main` deploys nothing here.** `.github/workflows/ci.yml` has no
deploy job, on purpose — the prod Worker holds a live log and the roadmap gates
new code on real usage. A `/ship` that stopped at `git push` would report
success while production stayed on last week's build. That has already happened
once in this repo.

So this skill is a deploy runbook, and the expensive steps are at the end.

---

## Stop for

- `tsc`, unit tests, or `recipes:check` failing
- A **destructive** migration (see Step 4) — always ask first
- A migration pending with **no backup taken this run**
- Anything that would put log data in the repo, or a secret in a commit

## Never stop for

- Uncommitted docs drift — stage it, it belongs with the change
- `npm run smoke` failing against **prod**. It is not idempotent and assumes an
  empty log; against real data its counting assertions fail by design. Read the
  tool-surface check and ignore the rest

## Never do

- Deploy with pending migrations and no backup
- Apply `seeds/dev_seed.sql` to prod. It sits outside `migrations/` precisely so
  `d1 migrations apply` cannot reach it
- Commit `.dev.vars`, `.gitnexus/`, `AGENTS.md`, or any file matching
  `Claude-Chat*` / `*transcript*`. The repo is **public**
- Force push
- Claim something is live without having called it

---

## Step 1 — Checks

```bash
npm run typecheck && npm test && npm run recipes:check
```

All three, always. They take seconds. A failure stops the ship.

If the change touches tools, the view, or `db/queries.ts`, also run the
matching suites against a **local** `wrangler dev` — they clear their own
tables, so they are safe to re-run:

```bash
npm run smoke            # 51 checks, needs a cleared local DB
npm run verify:events    # 33
npm run verify:pacing    # 32
npm run verify:session   # 50
npm run verify:program   # 46
```

Kill stale `workerd`/`node` first — `TaskStop` does not reap them, and testing
against yesterday's build has produced a wrong conclusion here more than once:

```powershell
Get-CimInstance Win32_Process -Filter "Name='workerd.exe' OR Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*delicious-macromiser*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Step 2 — Commit and push

Stage by path, not `git add -A`, then scan the whole push before it becomes
public and permanent:

```bash
git diff origin/main..HEAD | grep -nEi '^\+.*(MCP_PATH_SECRET *=|APP_VIEW_SECRET *=|APP_EDIT_SECRET *=|api[_-]?key|password|BEGIN [A-Z ]*PRIVATE KEY)'
git diff --cached --name-only | grep -E 'gitnexus/|AGENTS\.md|Claude-Chat|transcript'
```

Reading `.dev.vars` at runtime inside a script is fine and expected. A literal
secret value in a diff is not.

Commit message: `<type>: <summary>` with `type ∈ feat|fix|chore|refactor|docs|perf|test`.
Body says the *why* — this repo's history is a design record, not a changelog.
End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Then `git push origin main` and confirm CI:

```bash
gh run list --limit 1 --workflow=ci.yml
```

> **The `AGENTS.md` trap.** The GitNexus post-commit hook rewrites both
> `AGENTS.md` and `CLAUDE.md` on every commit. `AGENTS.md` is gitignored;
> strip the `<!-- gitnexus:start -->…<!-- gitnexus:end -->` block from
> `CLAUDE.md` before staging, or it lands in the repo. The permanent fix is
> `--skip-agents-md` in the global hook.

**If the user only said "push", stop here and say plainly that nothing is live.**

## Step 3 — Back up prod. Not optional when migrations are pending.

```bash
cd apps/server
npx wrangler d1 migrations list macromiser-prod --remote --env prod
```

If that lists nothing, skip to Step 5. If it lists anything:

```bash
STAMP=$(node -e "console.log(new Date().toISOString().replace(/[:.]/g,'-').slice(0,19))")
mkdir -p "C:/Users/brett/macromiser-backups"
npx wrangler d1 export macromiser-prod --remote --env prod \
  --output "C:/Users/brett/macromiser-backups/macromiser-prod-predeploy-$STAMP.sql"
```

**Outside the repo, always** — the repo is public and this file contains meals,
workouts and bodyweight. Then prove the backup is real rather than empty:

```bash
grep -c "INSERT INTO" "$OUT"        # expect > 0
grep -o "CREATE TABLE [a-z_]*" "$OUT"
```

The `/backup/<MCP_PATH_SECRET>` endpoint also works and writes to R2, but needs
the prod secret. The CLI export does not, which makes it the better default.

## Step 4 — Classify the migrations

```bash
git diff --stat origin/main..HEAD -- apps/server/migrations/
```

| Shape | Verdict |
|---|---|
| `CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN` nullable | **Additive** — proceed |
| `DROP`, `ALTER … RENAME`, a column made `NOT NULL`, a type change | **Destructive** — STOP and ask, even with a backup |
| A new foreign key pointing *back* at a table that already references this one | **STOP.** Circular FKs made two tables mutually undeletable here once and broke `restore.mjs --replace`, the only undo this project has |

## Step 5 — Migrate, then deploy. In that order.

```bash
cd apps/server && npm run db:migrate:prod
```

`db:migrate:prod` passes `macromiser-prod`; the plain `db:migrate` passes
`macromiser` and will not resolve under `--env prod`.

Verify the data survived before deploying — new tables should exist and be
empty, old ones unchanged:

```bash
npx wrangler d1 execute macromiser-prod --remote --env prod --command \
  "SELECT (SELECT COUNT(*) FROM meals) meals, (SELECT COUNT(*) FROM sets) sets"
```

Then, from the repo root — it rebuilds the recipe catalog the Worker bundles:

```bash
npm run deploy:prod
```

## Step 6 — Prove it, do not assert it

`/health` returns `{"ok":true}` on the old build too, so it proves the Worker is
up and nothing about *which* build. Confirm the version moved:

```bash
curl -s https://macromiser-prod.macromiser.workers.dev/health
cd apps/server && npx wrangler deployments list --env prod | grep "Created:" | tail -1
```

Then **call a tool against prod and look for a field only the new code
returns.** The session's MCP connector points at production, so this is a real
end-to-end check with no secret needed. Pick the newest field the change added —
`pace` on `get_today`, `events` on `get_briefing`, `best_ever` on
`get_last_performance`.

If the field is absent, the deploy did not take. Say so; do not report success.

## Step 7 — The two steps the server cannot do for itself

A deploy is not delivery here. Both of these are the operator's, and both have
silently blocked features in this repo before:

| Step | Why it matters |
|---|---|
| **Reconnect the connector** in claude.ai → Settings → Connectors | The client caches the tool list. New tools are invisible in chat until it refetches — `get_briefing` shipped and went unused for a full session because of this |
| **Re-upload the Skill** — `dist/macromiser-coach.zip` | A tool nothing tells the model to call is a tool that does not exist. **Run `npm run skill:build` yourself** so the operator is handed a current artifact, never asked to remember to rebuild it |

Check whether the Skill changed and mention it if so:

```bash
git diff --name-only origin/main..HEAD | grep -q '^skill/' && npm run skill:build
```

Then state the zip's path, its line count, and that it is current — the
operator's only remaining job is the upload itself, which needs their
authenticated claude.ai session and cannot be done from here.

## Step 8 — Report

State, in this order: the pushed range, CI result, where the backup is, which
migrations applied, the deployment version ID, **the tool call that proved it**,
and the outstanding operator steps. If any check was skipped, name it and say
why. A ship report that hides a skipped step is worse than no report.

---

## Ported from D-I Wine — what changed and why

| D-I Wine | Here |
|---|---|
| Push is the finish line; Railway auto-deploys | Push is the start; deploy is a separate manual act |
| `next build` conditional on risky files | No build step — the view has no framework and no bundler |
| Prisma schema safety scan | Numbered SQL migrations, plus a circular-FK check the parent has no reason to have |
| Backup only before table drops | **Backup before any pending migration.** There is one user, one database, and no staging |
| "Never ask for confirmation" | Same, with one addition: always ask on a destructive migration |
| Ends at push confirmation | Ends only after a tool call proves the new code is serving |
