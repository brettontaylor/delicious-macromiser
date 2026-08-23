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

Set alcohol_g to the grams of pure ethanol (a 5oz glass of 13% wine is about 15g, a 12oz 5% beer about 14g, a 1.5oz shot of 80-proof spirit about 17g) and do NOT also fold those calories into carbs. Set confidence to "low" when the portion is genuinely unclear rather than inventing precision.

Returns the updated running total for the day, so you can report where the user now stands without a second call.`,

  log_workout: `Record a completed training session, with every set in one call — not one call per set. Call this as soon as the user describes a session they finished.

If some loads or reps are ambiguous, log what is known and say which parts you guessed. Never skip the write to ask a clarifying question first: a session that goes unlogged is lost, while a flagged estimate can be corrected.

Use the exercise name the user actually said; the server normalizes it (so "squats", "back squat" and "Barbell Back Squats" all resolve to one history).`,

  log_bodyweight: `Record a bodyweight and/or waist measurement. Call this whenever the user mentions weighing or measuring themselves. Either field may be sent alone — sending only a waist measurement will not erase that day's weight. Upserts on the date, so a re-weigh on the same day replaces rather than duplicates.`,

  set_goals: `Set or change the user's daily calorie and macro targets, goal bodyweight, or weekly session count. Call this when the user states or revises a target. Goals are versioned by date and never overwritten, so past days keep being scored against the targets that were actually in force at the time.`,

  get_today: `Call this before answering ANY question about remaining calories, remaining macros, or what the user has eaten today. Never compute a running total from the conversation — meals may have been logged in an earlier session or from another device, and the conversation is not the source of truth.

Returns: every meal logged today, the totals, the remaining amount against the active goals, and food calories excluding alcohol. Also returns the user's local date, weekday and time, so you can judge whether protein is behind pace for the hour rather than guessing what time it is.`,

  get_last_performance: `Call this before recommending any weight for any exercise. Never propose a load from memory, from earlier in the conversation, or by inference from a different lift.

Returns, for each exercise requested: the most recent session's sets with reps, load and RPE, plus the three prior sessions so progression can be judged. Also returns how many days ago each session was, how many sessions have been logged for that lift, whether every set was completed, and the movement pattern — the facts a progression rule needs.

It returns data, not a recommendation. Apply your own progression rules to it. If sessions_logged is below 2, you do not yet have enough history to advance the load.`,

  get_week_summary: `Call this for any question about progress, trends, "how was this week", or whether something is working. A single day is noise; never answer a trend question from one day's data.

Returns 7-day (or requested-window) averages for calories, food calories excluding alcohol, protein, and alcohol; protein adherence as a percentage of logged days; session count; and average bodyweight and waist. Averages are computed over days that actually have data, and days_with_data is returned alongside so you can say plainly when a week is too sparse to read.`,

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
