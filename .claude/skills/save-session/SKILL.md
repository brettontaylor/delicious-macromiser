---
name: save-session
description: |
  End-of-session protocol for delicious-macromiser: run the full check suite,
  back up prod, confirm migrations and deploys actually landed, write the
  state-of-record (ROADMAP, plans, GOTCHAS), commit and push, verify CI, and
  produce a paste-ready handover for a fresh context. Ported from the WineGraph
  skill and adapted for a Worker + D1 + MCP product.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Save Session Protocol

Mostly automated. Run the steps, **write** the updates rather than suggesting
them, and end with a handover block. Only ask when an update is genuinely
ambiguous.

> The next session reads what you write and nothing else. Anything you leave in
> the conversation is lost.

---

## Step 1 — The check suite

```bash
npm run typecheck
npm test
npm run recipes:check
```

Then the end-to-end suite, which needs a running server and a **clean** database
(it is not idempotent):

```bash
cd apps/server && npx wrangler dev --port 8787   # background it
npx wrangler d1 execute macromiser --local --command \
  "DELETE FROM sets; DELETE FROM workouts; DELETE FROM meals; DELETE FROM captures; DELETE FROM bodyweight; DELETE FROM goals; DELETE FROM portion_memory; DELETE FROM training_plan; DELETE FROM pantry;"
npm run smoke
```

Kill orphaned `workerd`/`node` processes first — see GOTCHAS. If anything is
red, say so prominently with the failing output and do **not** call the session
green.

## Step 2 — Back up production

Cheap, and it is the only undo this project has:

```bash
curl -X POST https://macromiser-prod.macromiser.workers.dev/backup/<MCP_PATH_SECRET>
```

Report the row count. A count that dropped unexpectedly is worth investigating
before you close the session.

## Step 3 — Did it actually ship?

Local green is not shipped.

```bash
ls apps/server/migrations | tail -3
git log --oneline -12
```

- **New migration?** Confirm it is applied to prod, not just locally. The two
  drift silently and the next deploy fails against a schema that never changed.
- **Server code changed?** Confirm a deploy went out and the running version is
  the one you built. Check `tools/list` returns the expected count.
- **Recipes changed?** The catalog is rebuilt on deploy — confirm the change is
  actually live, not just in the file.

## Step 4 — Retrospective

Compact — a few bullets each.

| Lens | Capture |
|---|---|
| **Shipped** | what was built, and whether it is live or only committed |
| **Decisions** | operator decisions and how they resolved → the relevant plan |
| **Bugs found** | especially ones found by a check rather than by eye — those are the ones worth writing down |
| **Rework** | anything done twice, and why. The "why" is the durable part |
| **Blocked** | what is waiting on the operator, and precisely what unblocks it |
| **Seeds** | "do X once Y lands" |

## Step 5 — Write the state-of-record

Every doc that drifted. A fresh `/start-session` reads these.

1. **`docs/ROADMAP.md`** — tick what shipped, add what emerged, move what is
   blocked. Keep the reasoning for a decision next to the decision; a checked box
   with no "why" gets re-litigated.
2. **`docs/plans/*.md`** — update status, mark decisions taken, record the
   finding if a phase produced one.
3. **`docs/GOTCHAS.md`** — **append anything that cost time this session.** New
   entry at the top of its section: the symptom first, then the cause, then the
   fix. If you debugged something for more than ten minutes, it belongs here.
4. **`docs/DEV.md`** — only if how to run or deploy the thing changed.
5. **`CLAUDE.md`** — only if a guardrail changed. Keep it lean.
6. **`skill/SKILL.md`** — if a tool was added or its behaviour changed. **A tool
   nothing tells the model to call is a tool that does not exist.** Copy it to
   `~/.claude/skills/macromiser-coach/SKILL.md` and remind the operator to
   re-upload the zip to claude.ai if the coaching layer changed.

## Step 6 — Commit, push, verify

Commit messages here carry reasoning, not just a summary — say what was tried,
what broke, and why the shape is what it is. Then:

```bash
git push origin main
gh run list --limit 1 --workflow=ci.yml     # wait for it, do not assume
```

CI green is part of the session being done. If it is red, fix it now; a red main
is the worst thing to hand to a fresh context.

## Step 7 — Handover

Output a block the operator can paste into a new session:

```
## Handover — <date>

**Live:** <prod version, tool count, anything notable about the log>
**Shipped:** <2-4 bullets, each with whether it is deployed>
**Open decisions:** <what is waiting on the operator, and what unblocks it>
**Next:** <the 2-3 things a fresh session should consider, ranked>
**Watch out for:** <anything mid-flight, or a gotcha that bit this session>
```

---

## Discipline

- Write the updates. Suggesting them means they do not happen.
- Report failures plainly, including your own. A save-session that never
  records a bug is not recording the session.
- Do not mark something shipped that is only committed.
- No new work in save-session. If you find something, write it down and stop.
