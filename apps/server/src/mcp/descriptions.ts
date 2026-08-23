/**
 * Tool descriptions. Treat as product copy, not comments.
 *
 * ARCHITECTURE.md §5: the model's behavior is driven almost entirely by these
 * strings. Each one answers *when to call this*, not *what it does*, and states
 * the failure it exists to prevent. COACHING-LAYER.md lists the failure modes
 * these are written against — a model that answers from conversation context
 * instead of calling the tool.
 */

export const DESCRIPTIONS = {
  log_meal: `Record food or drink the user has eaten. Call this as soon as the user describes something they ate or drank — do not ask permission first, and do not wait for them to finish listing everything. Estimate kcal and macros yourself from the description; the server stores what you send and never re-estimates. State the estimate you used in your reply so the user can correct it.

If this meal came from a capture in the app, pass capture_id — the capture is closed in the same call, so you do not need resolve_capture afterwards.

If the user ate something from their recipe book, pass recipe_slug and servings INSTEAD of kcal and macros. The numbers then come from the recipe itself — portions that were measured and written down when it was cooked — so the entry is recorded at high confidence and any macros you also send are ignored. Call list_recipes if you are unsure of the slug. Do not use recipe_slug for something merely similar to a recipe; that is an estimate, and it should be logged as one.

Set alcohol_g to the grams of pure ethanol (a 5oz glass of 13% wine is about 15g, a 12oz 5% beer about 14g, a 1.5oz shot of 80-proof spirit about 17g) and do NOT also fold those calories into carbs. Set confidence to "low" when the portion is genuinely unclear rather than inventing precision.

Returns the updated running total for the day, so you can report where the user now stands without a second call.`,

  log_workout: `Record a completed training session, with every set in one call — not one call per set. Call this as soon as the user describes a session they finished.

If some loads or reps are ambiguous, log what is known and say which parts you guessed. Never skip the write to ask a clarifying question first: a session that goes unlogged is lost, while a flagged estimate can be corrected.

Use the exercise name the user actually said; the server normalizes it (so "squats", "back squat" and "Barbell Back Squats" all resolve to one history).`,

  log_bodyweight: `Record a bodyweight and/or waist measurement. Call this whenever the user mentions weighing or measuring themselves. Either field may be sent alone — sending only a waist measurement will not erase that day's weight. Upserts on the date, so a re-weigh on the same day replaces rather than duplicates.`,

  set_goals: `Set or change the user's daily calorie and macro targets, goal bodyweight, or weekly session count. Call this when the user states or revises a target. Goals are versioned by date and never overwritten, so past days keep being scored against the targets that were actually in force at the time.`,

  get_today: `Call this before answering ANY question about remaining calories, remaining macros, or what the user has eaten today. Never compute a running total from the conversation — meals may have been logged in an earlier session or from another device, and the conversation is not the source of truth.

Returns: every meal logged today (each with its id, for correct_meal), the totals, the remaining amount against the active goals, and food calories excluding alcohol. Also returns known_portions — phrases the user has already corrected once, whose figures you should reuse instead of re-estimating — and pending_captures, the number of things logged in the app that still need analyzing. If that is above zero, call get_pending_captures and offer to work through them. Also returns the user's local date, weekday and time, so you can judge whether protein is behind pace for the hour rather than guessing what time it is.`,

  get_last_performance: `Call this before recommending any weight for any exercise. Never propose a load from memory, from earlier in the conversation, or by inference from a different lift.

Returns, for each exercise requested: the most recent session's sets with reps, load and RPE, plus the three prior sessions so progression can be judged. Each session carries its workout_id, so a number the user says is wrong can be fixed with correct_workout without hunting for it. Also returns how many days ago each session was, how many sessions have been logged for that lift, whether every set was completed, and the movement pattern — the facts a progression rule needs.

It returns data, not a recommendation. Apply your own progression rules to it. If sessions_logged is below 2, you do not yet have enough history to advance the load.`,

  get_week_summary: `Call this for any question about progress, trends, "how was this week", or whether something is working. A single day is noise; never answer a trend question from one day's data.

Returns 7-day (or requested-window) averages for calories, food calories excluding alcohol, protein, and alcohol; protein adherence as a percentage of logged days; session count; and average bodyweight and waist. Averages are computed over days that actually have data, and days_with_data is returned alongside so you can say plainly when a week is too sparse to read.`,

  get_pending_captures: `Things the user recorded in the app that are not yet meals. Call this at the START of a session when get_today reports pending_captures above zero, and offer to work through them before anything else.

The app has no AI of its own by design — it captures, and you analyze. That is what keeps this running on the model the user already pays for rather than on ours.

For each capture: estimate the macros from the note and call log_meal with capture_id set. That logs the meal AND closes the capture in a single call. If a note is genuinely too vague to estimate, call resolve_capture with state "unusable" and say why — never invent numbers to clear the queue, because a made-up entry corrupts the very averages the user is tracking.`,

  resolve_capture: `Close a capture that will not become a meal — one too vague to estimate from. Requires a reason, and you should repeat that reason to the user rather than letting the entry vanish quietly.

Do NOT use this for a capture you successfully logged: log_meal with capture_id already closes those. This is only for the ones you are declining to guess at.`,

  get_next_meal: `When the user is likely to eat next, and what they have left to spend. Call this for "what should I eat next", "what's for lunch", or any planning question about the rest of the day.

Returns the typical time for each meal slot, computed from the user's own logs, together with today's remaining calories and macros. It returns facts, not a suggestion — apply your own judgement about what to actually recommend, and use list_recipes if they want something from their own book.

Only meals logged on the day they were eaten inform the timing; backfilled history carries the time it was written, not the time it was eaten. If unavailable_because is set, say plainly that there is not enough history yet rather than guessing a mealtime.`,

  correct_workout: `Fix a logged training session — a mistyped load, a rep count that was wrong, a set that did not actually happen. Call this the moment the user corrects one, rather than logging a second session.

This matters more than correcting a meal. A wrong meal number sits in an average; a wrong SET number propagates — get_last_performance reads it and the next session's load is proposed from it, so one bad rep count quietly drives a wrong recommendation until someone notices.

Address sets by set_no within the session, which is how people refer to them ("the third set was only 3 reps"). Send remove: true for a set that never happened. Send null for a value that is genuinely unknown rather than guessing one. Get workout_id from get_last_performance or get_history.`,

  delete_workout: `Remove a training session that should not have been logged — a duplicate, or one recorded against the wrong day. Prefer correct_workout when the session happened but the numbers are wrong; deleting and re-logging loses the correction.

Soft-deleted and recoverable. Get workout_id from get_last_performance or get_history.`,

  correct_meal: `Fix a meal that was logged with the wrong numbers. Call this the moment the user corrects an estimate — "that was closer to 900 calories", "it was 8oz not 12" — rather than logging a second meal to compensate.

Send only the fields that are wrong; everything else is left alone. Get the meal_id from get_today or get_history.

The corrected entry is recorded as source="corrected" at high confidence, because a human has now looked at the numbers. If the macros changed, the description is also remembered as a reusable portion, so your next estimate of the same phrase starts from the corrected figure instead of from scratch. Tell the user when that happens.`,

  delete_meal: `Remove a meal that should not have been logged — a duplicate, or something the user did not actually eat. Prefer correct_meal when the entry is real but the numbers are wrong; deleting and re-logging loses the correction history.

The row is soft-deleted and stays recoverable. Get the meal_id from get_today or get_history.`,

  list_recipes: `The user's own cookbook, with per-serving macros already calculated. Call this when they ask what to cook, what fits their remaining macros, or whether a dish is in the book.

Returns facts, not a recommendation — which dishes exist, what a serving costs, and a per-component breakdown so a serving eaten without the rice can still be logged accurately. Apply your own judgement about what to suggest.

When they eat one of these, log it with log_meal using recipe_slug rather than estimating.`,

  import_days: `Backfill many days of history in ONE call. Use this — not repeated log_meal and log_workout calls — whenever reconstructing more than a day or two, for example from an earlier conversation or another tracker.

Each call approval interrupts the user, so twenty separate writes is twenty interruptions and a real chance the run is abandoned half-finished. Send the whole reconstruction as a single days array instead.

Everything written here is marked source="import", because a reconstructed entry is weaker evidence than one captured as it happened and the trend views need to tell them apart. Only include numbers the user actually stated or that were calculated at the time; omit a field rather than inventing it.

This is NOT idempotent for meals and workouts — calling it twice writes everything twice. Confirm the full list with the user before calling it, and never retry a call that may have partly succeeded.`,

  get_history: `Retrieve meals, workouts and bodyweight for an explicit date range. Use this for questions that reach further back than the current week, for export, and for "how was last month". Prefer get_today for today and get_week_summary for the current week — both are cheaper and shaped for the question.`,
} as const;

/** Shared arg-level descriptions, so the same field reads the same everywhere. */
export const ARG_DOCS = {
  when: 'Optional ISO8601 timestamp or YYYY-MM-DD. Omit for now. Use only when logging something from an earlier day the user explicitly names.',
  date: 'Optional YYYY-MM-DD. Omit for today.',
  source:
    'Where the entry came from. Omit for a normal live log. Use "import" only when backfilling an entry reconstructed from an earlier conversation or an external tool, so reconstructed history stays distinguishable from data captured as it happened.',
  confidence:
    'How sure you are of the macro estimate. "high" for a packaged item or a weighed portion, "medium" for a described home portion, "low" for a restaurant dish or a vague description.',
  alcohol_g:
    'Grams of pure ethanol, not grams of drink. Leave 0 for anything non-alcoholic. Do not also count these calories as carbs.',
  exercise:
    'Exercise name as the user said it. Normalized server-side, so no particular spelling is required.',
  rpe: 'Rate of perceived exertion, 1-10. Include it whenever the user signals difficulty ("that was easy", "barely got the last one") — it is what makes a progression decision possible.',
} as const;
