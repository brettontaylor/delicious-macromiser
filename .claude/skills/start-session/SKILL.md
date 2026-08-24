---
name: start-session
description: |
  Start-of-session briefing for delicious-macromiser: sync git, read the
  state-of-record (ROADMAP, plans, GOTCHAS), check prod health and the LIVE LOG,
  surface what is blocked, and offer the next move. Fully automated — the user
  says /start-session and gets a concise briefing. Ported from the WineGraph
  skill and adapted for a Worker + D1 + MCP product.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Start Session Protocol

Orient fast, then offer the next move. Run every step, then output the briefing.
Keep it tight.

> **What this can and cannot recall.** A fresh context has **no access to the
> prior conversation**. It recalls only what is written down. The quality of this
> briefing is exactly the quality of what the last `/save-session` wrote — if it
> is not in ROADMAP, `docs/plans/`, or GOTCHAS, it is gone.

This product has a property most repos do not: **it has live user data, and the
state of that data is part of the state of the project.** A briefing that reports
the code and not the log has missed half of it.

---

## Step 1 — Sync git, read the state-of-record

Sync first so you brief against reality:

```bash
git fetch origin 2>/dev/null; git status --short; git branch --show-current
git log --oneline -8
git log --oneline HEAD..origin/main    # anything you are behind
```

Flag uncommitted or unpushed work. Then read, in this order:

1. **`docs/ROADMAP.md`** — phases, what shipped, what is open. The single map.
2. **`docs/GOTCHAS.md`** — the top of each section. This is what stops you
   repeating last session's mistake; it is short on purpose, read it.
3. **`docs/plans/`** — any plan with status other than shipped. These carry the
   open decisions.
4. **`CLAUDE.md`** — guardrails, only if unfamiliar with the repo.

## Step 2 — Health: the code

```bash
npm run typecheck && npm test && npm run recipes:check
```

Only surface these if abnormal. Also check CI on the last push:

```bash
gh run list --limit 1 --workflow=ci.yml
```

## Step 3 — Health: production

The Worker is live and holds real data. Check it is actually up, and which
version:

```bash
curl -s https://macromiser-prod.macromiser.workers.dev/health
npx wrangler deployments list --env prod 2>/dev/null | head -5
```

## Step 4 — The log (the step other repos do not have)

Read the product's actual state through its own tools. This is often where the
most useful line of the briefing comes from.

```bash
# tools/list — confirms the surface, and the count catches a failed deploy
curl -sS -X POST "$BASE/mcp/$MCP_PATH_SECRET" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# get_today — pending captures, whether today is logged, goals set
# get_training_plan — is a split set up
```

Surface only what matters:

- **Pending captures above zero** — the user logged something in the app that
  nobody analyzed. This is the single most actionable thing a briefing can say.
- **Nothing logged today** and it is past midday.
- **No backup since yesterday** (the cron runs 07:10 UTC).
- Goals or training plan unset.

## Step 5 — What is blocked

Anything waiting on the operator, from `docs/plans/` open decisions and the
roadmap. Name it plainly with what unblocks it. A blocked item that is not
surfaced stays blocked.

## Step 6 — Skills

| Category | Skills |
|---|---|
| Session | `/start-session`, `/save-session` |
| Planning | `/design-plan` (writes), `/plan-review` (critiques), `/verify` (proves) |

---

## Output

Two-tier and tight. Technical detail only when abnormal.

```
# macromiser — <day, MMM DD>

## Live
[prod up? version, tool count, and the LOG state — pending captures,
 today's totals, plan set. Two or three lines.]

## Where the build is
[current phase + what shipped last, from ROADMAP. One short table.]

## Blocked on you
[table: what, and what unblocks it. Omit the section if genuinely nothing.]

## Suggested next moves
[3-5 ranked, each tied to a real signal — an open decision, a roadmap item,
 a health flag. Not a wish list.]

What would you like to work on?
```

Then stop. Do not start building until the operator picks, unless they already
said.

## Discipline

- Tables for any list of 3+.
- **Verify before claiming.** "prod is up" needs the actual curl. No "should be".
- No flattery, no decorative emoji.
- If a check failed, say so with the output. A briefing that hides a red test is
  worse than no briefing.
