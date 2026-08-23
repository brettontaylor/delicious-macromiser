---
name: plan-review
description: >
  Adversarial review of a design plan BEFORE implementation. Challenges scope,
  hunts for the pattern that already exists, checks the server/judgement
  boundary, and pressure-tests phasing and verification. Use on any plan written
  by /design-plan, or when asked to "review the plan", "poke holes in this", or
  "is this the right approach". Ported from the D-I Wine skill. Distinct from
  /design-plan, which writes plans; this one critiques them and does not edit code.
---

# Plan Review

The job is to find the thing that will be discovered as wrong halfway through
implementation, while changing it is still cheap. Be direct. A plan that
survives this unchanged is rare and slightly suspicious.

Read the plan in full, then the code it claims to describe. **Do not trust the
plan's account of the current build** — that is the most common place a plan is
already wrong.

---

## 1. Scope challenge

- What in this plan would nobody miss if it shipped without it?
- Is any phase carrying work that belongs in a later one, or none at all?
- Is the plan solving the stated problem, or a more interesting adjacent one?
- Does `PRODUCT.md`'s non-objectives list already rule any of this out?

## 2. Grounding check

Spot-check three `file:line` claims. If any is wrong or stale, say so and treat
the rest of the plan's grounding as unproven until re-checked.

- Does the "current build does X" column match the code?
- Is there a proven pattern the plan reinvents? Name it with a path.

## 3. The boundary

The single most likely architectural error in this repo.

- Does any proposed tool return a recommendation rather than the data a
  recommendation needs? That belongs in `skill/SKILL.md`.
- Does any coaching rule get hardcoded where changing it would cost a deploy?
- Is the model being asked to re-derive something the server already knows, or
  the server asked to judge something only the model can?

## 4. Evidence and undo

- Does every new write path state its `source` and `confidence`?
- Can reconstructed data still be told apart from data captured live?
- Is there an undo for every new writable thing — or an explicit statement that
  there is not?

## 5. Security and capability

- Does anything widen what a shared read link can do?
- Does a new secret earn its existence, or should it reuse one?
- Does any user-supplied value reach SQL, HTML, or a URL without escaping?

## 6. Phasing

- Can each phase actually ship alone, or does phase 1 leave the build broken?
- Is the highest-unblocking phase first?
- Is anything deferred that will be much more expensive later (schema shape,
  a public URL, anything a user will bookmark)?

## 7. Verification

- Does each phase have a check that would actually FAIL if the work were wrong?
- "Typecheck passes" proves nothing about behaviour. Is there an assertion on a
  stored row, or on rendered content?
- Is a prod-touching phase preceded by a backup?

---

## Output

A short verdict, then findings ordered by cost-if-missed:

```
VERDICT: ship it / fix these first / rethink the approach

BLOCKING
1. <finding> — why it breaks, what to do instead

WORTH FIXING
2. ...

CONSIDERED AND FINE
- <thing that looks wrong but is justified, so nobody re-raises it>
```

That last section matters: a review that only lists problems gets re-litigated.
Say what you checked and deliberately passed.

---

## Anti-patterns

- Agreeing with the plan because it is well written
- Listing style nits while a phase-ordering bug goes unmentioned
- Proposing a rewrite when three targeted fixes would do
- Reviewing the plan's description of the code instead of the code
