---
name: verify
description: >
  Goal-backward verification: checks whether a feature actually WORKS against a
  running server, not whether the code compiles. Takes a goal, derives the
  must-haves, exercises each one, and reports PASS/FAIL with evidence. Use after
  finishing a feature or phase, before deploying, or when asked "does it work",
  "verify this", "prove it". Ported from the D-I Wine skill and adapted for a
  Worker + D1 + server-rendered stack.
---

# Verify

Typecheck proves the code is well-formed. It proves nothing about whether the
feature does what it was built to do. This skill closes that gap.

**Evidence or it did not happen.** Every PASS carries the command and the value
returned. A PASS with no evidence is an assertion, and assertions are what this
skill exists to replace.

---

## Step 1 — State the goal in one sentence

From the user's words, not from the code. "A meal logged from a recipe stores
the recipe's macros, not an estimate."

## Step 2 — Derive the must-haves

3-7 checks that would each independently prove the goal false if they failed.
Prefer checks on **stored state and rendered output** over checks on responses —
a tool can return `{ok: true}` and write nothing.

Include at least one **negative** check. A feature that cannot be broken by bad
input has not been tested; it has been demonstrated.

## Step 3 — Set up a truthful environment

```bash
cd apps/server
npx wrangler dev --port 8787          # background it
# the smoke test and most assertions assume an empty log
npx wrangler d1 execute macromiser --local --command \
  "DELETE FROM sets; DELETE FROM workouts; DELETE FROM meals; DELETE FROM bodyweight; DELETE FROM goals; DELETE FROM portion_memory;"
```

Stale local state is the most common cause of a false FAIL here — and of a false
PASS, when a row from a previous run happens to satisfy the check.

Kill orphaned servers before starting: stopping the wrangler task does not
always stop its `workerd` children, and a stale one holding the port will serve
the OLD build while you test the new one. This has caused real wasted time.

## Step 4 — Exercise each check

**A tool:**
```bash
curl -sS -X POST "$BASE/mcp/$SECRET" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{...}'
```
then assert the **stored row**:
```bash
npx wrangler d1 execute macromiser --local --command "SELECT ... FROM meals WHERE ..."
```

**A view:** fetch the HTML and assert on content.
```bash
curl -s "$BASE/app/$SECRET?date=2026-08-23" | grep -oE '<b>[0-9]+</b> kcal'
```
A 200 is not evidence. The number on the page is.

**A capability:** prove the negative — that the read secret gets 403 on a write
path, that a wrong secret gets 404.

## Step 5 — Report

```
GOAL: <one sentence>

PASS  <check>  — <command> -> <actual value>
FAIL  <check>  — expected <x>, got <y>
      cause:   <what is actually wrong>
      fix:     <smallest change that would make it pass>

VERDICT: works / works with caveats / does not work
```

Report FAILs plainly, including when the code is yours. A verification pass that
never fails anything is not verifying.

---

## Anti-patterns

- Reporting PASS from a tool's response instead of the stored row
- Verifying against a stale dev server or a dirty local database
- Only happy paths — no bad input, no wrong secret, no missing field
- "It should work" anywhere in the output
- Verifying on local and claiming it works on prod, or the reverse
