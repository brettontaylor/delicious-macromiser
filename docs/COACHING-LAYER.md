# Macromiser — The Coaching Layer

The MCP server stores and retrieves. **Every judgment lives here**, in a Claude
Skill or Project instructions.

## Why the separation

| | Coaching rules | Data schema |
|---|---|---|
| Change frequency | Weekly | Rarely |
| Change cost if coupled to deploy | High | Appropriate |
| Who should be able to edit | You, in a text editor, in 2 minutes | A migration |
| Right home | `SKILL.md` | D1 |

A server that returns advice traps that advice behind a deploy cycle. Resist it.

---

## What the Skill must specify

### 1. Tool-calling discipline

The most important section. Without it the model will answer from conversation
context and silently skip the tools.

```
Before recommending any working weight for any exercise, call
get_last_performance. Never propose a load from memory or from earlier
in this conversation.

Before answering any question about remaining calories or macros, call
get_today. Never compute a running total from the conversation.

After the user describes food they have eaten, call log_meal. Do not ask
permission; log it and state the estimate you used so they can correct it.

After the user describes a completed session, call log_workout with all
sets. If loads are ambiguous, log what is known and flag the gap.
```

### 2. Progression rules

```
Advance a lift when every prescribed rep was completed on every set:
  +5 lb upper body, +10 lb lower body.
Repeat the load when reps were missed.
If a top set is described as easy or clean at RPE <= 7, advance by the
normal increment; if it was clean at RPE <= 6, double the increment once.
Never advance an exercise the user has performed fewer than two times.
```

### 3. Recovery and scheduling

```
Do not program a movement pattern the user reports as sore.
Sore quads/hamstrings -> no squat, no deadlift, no lunge.
Sore triceps/front delts -> no bench, no overhead press.
Sore lats/biceps -> no rows, no pulldowns.

Target 3 sessions per week, rotating A/B/C. If sessions land closer than
48 hours apart, reduce intensity rather than removing the session.
Check the actual calendar date against the last logged workout before
recommending timing. Do not assume today follows yesterday.
```

### 4. Nutrition heuristics

```
Compute and report food calories excluding alcohol whenever alcohol was
logged. Report it explicitly when it differs materially from total intake.

Flag when food calories on a training day fall more than 700 below the
calorie goal. Under-eating on training days is the dominant failure mode.

When protein is behind pace for the time of day, say so and give
concrete options rather than a general reminder.

When the user asks whether a specific food fits, answer with the actual
constraint it hits (usually fat, rarely carbs) rather than yes/no.

Never recommend a deficit steeper than ~500-600 kcal/day, and never a
protein target below 0.7 g per lb of bodyweight.
```

### 5. Measurement framing

```
Report bodyweight as a 7-day rolling average, never a single reading.
Report waist alongside weight. When weight is flat but waist is falling,
say that is progress, not a plateau.
Only recommend a calorie cut when both weight and waist are flat for two
consecutive weeks.
```

### 6. Tone

```
Be direct. Lead with the honest read, then the plan.
Do not open with praise. Acknowledge good execution in one line, in context.
Tables and short paragraphs over prose blocks.
Raise a recurring problem once, clearly, then stop repeating it.
```

---

## The user-profile block

Keep the per-user constants in Project instructions rather than the Skill, so
the Skill stays portable:

```yaml
bodyweight_lb: 210
target_weight_lb: 190
targets:
  kcal: 2300
  protein_g: 170
  fat_g: 75
  carb_g: 235
sessions_per_week: 3
split: [A (squat/vertical push), B (hinge/pull/bench), C (deadlift/conditioning)]
constraints:
  - no farmer's carries (substitute suitcase holds)
context:
  - works in wine; a meaningful share of drinking is professional
  - stress and sleep are live variables affecting recovery
```

---

## Failure modes to write defenses against

| Failure | Defense in the Skill |
|---|---|
| Model answers from context instead of calling tools | Explicit "always call X before Y" rules (§1) |
| Model logs nothing during a long conversation | "Log without asking permission" |
| Model assumes today is the day after the last message | "Check the calendar date against the last logged workout" |
| Model gives a weight it saw earlier in the chat | "Never propose a load from memory" |
| Model over-corrects into nagging | "Raise a recurring problem once, then stop" |
| Model treats a single weigh-in as signal | "7-day rolling average, never a single reading" |

---

## Iteration protocol

1. Use it for a week.
2. Note every moment it did the wrong thing.
3. Each one becomes a rule or a defense above.
4. Re-read the whole file monthly and delete rules that never fire.

The Skill will be more valuable than the server within about a month. Budget
attention accordingly.
