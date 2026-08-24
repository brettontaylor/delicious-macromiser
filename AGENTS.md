<!-- gitnexus:start -->
# GitNexus — code intelligence

This repo is indexed by GitNexus (`.gitnexus/`, gitignored — 45 MB, never commit it).
Re-index with `npx gitnexus analyze`; a global hook does this after `git commit`.

**Read `CLAUDE.md` first.** It carries the guardrails and the docs map. This file
only covers when the graph is worth consulting.

## Use it for one thing: blast radius on shared helpers

This is a ~6,000-line codebase with a flat, documented structure. For most
questions, `Grep` is faster and just as correct — do not add a round trip to
learn something one search answers.

The graph earns its place in exactly one situation: **you are about to change a
function in `db/queries.ts`, `domain/`, or a write path, and you want the full
caller set before you touch it.**

```bash
npx gitnexus impact <symbol> --repo delicious-macromiser --direction upstream
```

Verified accurate on this repo — `getBodyweightRange` returns its five real
callers, `trendChart` its one.

Worth running before editing any of these, where a wrong assumption is expensive:

| Symbol | Why |
|---|---|
| `getSetsForExercise` | Feeds `get_last_performance`, which drives every load recommendation |
| `insertWorkout`, `logWorkout` | Shipped write paths over live training data |
| `sumMeals`, `remainingVsGoals` | Every totals surface reads these |
| `getGoalsAsOf` | Goals are versioned; a change here is silently retroactive |
| Anything in `db/queries.ts` with 3+ callers | The extract-vs-inline call |

## What does not apply here

- **`gitnexus_*` MCP tools are not connected in this project.** Use the CLI
  above. If the MCP server is wired up later, the tool names in
  `.claude/skills/gitnexus/` become live.
- **`detect-changes` is MCP-only** — it is not a CLI command in 1.5.3, so the
  global post-commit hook that calls it is a no-op.
- **Do not run impact analysis before every edit.** For a pure function in
  `domain/` with two callers, that is ceremony. Read the file.

## Renaming

`npx gitnexus rename` is not exposed on the CLI either. For a rename that
crosses files, run `impact` first to get the caller set, then edit them
explicitly — never a blind find-and-replace, because `exercise`, `sets`, and
`source` all appear as both identifiers and SQL column names.

## Keeping it honest

`.gitnexus/meta.json` records the commit it was built from. If that is not
`HEAD`, the graph is stale and its answers are about the old code. Re-analyze
rather than trusting it.

<!-- gitnexus:end -->
