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

  get_briefing: `Where the user stands, in ONE call: today's totals and what is left, anything waiting in the capture queue (with the notes inline), today's training plan and the next lift day, the week's shape, latest bodyweight, and portions they have already corrected.

**Call this FIRST in any session that starts with an open question** — "how am I doing", "what should I eat", "catch me up", or any greeting that implies looking at the log. It replaces get_today + get_training_plan + get_week_summary + get_pending_captures, which is four round trips and four pauses in what should feel like a conversation.

If pending_captures.count is above zero, the user logged something in the app that nobody analyzed — offer to work through it before anything else. Only call get_pending_captures when a capture has an image you need to SEE; the notes are already here.

Follow up with a specific tool only when you need more: get_last_performance before recommending a load, list_recipes for what to cook.`,

  get_today: `Call this before answering ANY question about remaining calories, remaining macros, or what the user has eaten today. Never compute a running total from the conversation — meals may have been logged in an earlier session or from another device, and the conversation is not the source of truth.

Returns: every meal logged today (each with its id, for correct_meal), the totals, the remaining amount against the active goals, and food calories excluding alcohol. Also returns known_portions — phrases the user has already corrected once, whose figures you should reuse instead of re-estimating — and pending_captures, the number of things logged in the app that still need analyzing. If that is above zero, call get_pending_captures and offer to work through them. Also returns the user's local date, weekday and time, so you can judge whether protein is behind pace for the hour rather than guessing what time it is.`,

  get_last_performance: `Call this before recommending any weight for any exercise. Never propose a load from memory, from earlier in the conversation, or by inference from a different lift.

Returns, for each exercise requested: the most recent session's sets with reps, load and RPE, plus the three prior sessions so progression can be judged. Each session carries its workout_id, so a number the user says is wrong can be fixed with correct_workout without hunting for it. Also returns how many days ago each session was, how many sessions have been logged for that lift, whether every set was completed, and the movement pattern — the facts a progression rule needs.

It returns data, not a recommendation. Apply your own progression rules to it. If sessions_logged is below 2, you do not yet have enough history to advance the load.`,

  get_week_summary: `Call this for any question about progress, trends, "how was this week", or whether something is working. A single day is noise; never answer a trend question from one day's data.

Returns 7-day (or requested-window) averages for calories, food calories excluding alcohol, protein, and alcohol; protein adherence as a percentage of logged days; session count; and average bodyweight and waist. Averages are computed over days that actually have data, and days_with_data is returned alongside so you can say plainly when a week is too sparse to read.`,

  get_pending_captures: `Things the user recorded in the app that are not yet meals. Call this at the START of a session when get_today reports pending_captures above zero, and offer to work through them before anything else.

The app has no AI of its own by design — it captures, and you analyze. That is what keeps this running on the model the user already pays for rather than on ours.

A capture may be a typed note, a PHOTO, or both. Photos arrive as images attached to this tool's result, in the order given by images_attached — look at them and estimate from what you can actually see. If a photo is too dark or too ambiguous to judge portions, say so and resolve it as unusable rather than guessing; a made-up number is worse than an unlogged meal.

For each capture: estimate the macros and call log_meal with capture_id set. That logs the meal AND closes the capture in a single call. If a note is genuinely too vague to estimate, call resolve_capture with state "unusable" and say why — never invent numbers to clear the queue, because a made-up entry corrupts the very averages the user is tracking.`,

  resolve_capture: `Close a capture that will not become a meal — one too vague to estimate from. Requires a reason, and you should repeat that reason to the user rather than letting the entry vanish quietly.

Do NOT use this for a capture you successfully logged: log_meal with capture_id already closes those. This is only for the ones you are declining to guess at.`,

  set_pantry: `The user's kitchen, as two lists. "staple" is what they always have and changes a few times a year; "fresh" is a short list of what is in the house right now.

This is deliberately NOT an inventory — no quantities, nothing decrements. Do not offer to track amounts; a pantry that claims to know you have 1.5 onions is wrong within a week and worse than none.

Use replace_kind: "fresh" when the user tells you what they bought or what is in the fridge now — that clears the old list first, so it is one call rather than a diff.`,

  get_pantry: `What the user has in the house. Call this before answering "what can I make", alongside list_recipes.

used_by_no_recipe is what they own that nothing in their book uses — a good prompt to add a recipe, not a complaint.`,

  set_training_plan: `Define or change the user's weekly training split — which weekdays are lift days, which are rest or active recovery, and any standing rules for a day ("walk 10,000 steps", "no alcohol", "no phone after 8").

Upserts one weekday at a time, so moving leg day is a single call and not a rewrite of the whole week. Call this when the user describes their split or changes it.`,

  get_training_plan: `What today is meant to be, and when the next lift day falls. Call this for "what am I doing today", "when's my next lift", or any planning question about training.

Returns facts — the day's kind, its label, the user's own standing rules for it, and how many days until the next lift day. Whether they should actually train, push, or skip given recent sessions and recovery is YOUR judgement; combine this with get_last_performance rather than reading it as an instruction.

no_plan_set true means they have never set a split up. Say so and offer to build one rather than implying today is a rest day.`,

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

When they eat one of these, log it with log_meal using recipe_slug rather than estimating.

If a pantry is set up, each recipe also reports have and missing against it, best-covered first. Those are facts — deciding what is actually cookable tonight is YOUR judgement, and a missing herb is not a missing protein. have and missing are null (not empty) when no pantry exists; do not read that as an empty kitchen.`,

  import_days: `Backfill many days of history in ONE call. Use this — not repeated log_meal and log_workout calls — whenever reconstructing more than a day or two, for example from an earlier conversation or another tracker.

Each call approval interrupts the user, so twenty separate writes is twenty interruptions and a real chance the run is abandoned half-finished. Send the whole reconstruction as a single days array instead.

Everything written here is marked source="import", because a reconstructed entry is weaker evidence than one captured as it happened and the trend views need to tell them apart. Only include numbers the user actually stated or that were calculated at the time; omit a field rather than inventing it.

This is NOT idempotent for meals and workouts — calling it twice writes everything twice. Confirm the full list with the user before calling it, and never retry a call that may have partly succeeded.`,

  log_event: `Record something that changes how the user's OWN NUMBERS should be read — starting or stopping a supplement, travel, an injury, illness, a deload week, a stretch of unusual work stress.

Call this whenever the user mentions one of those. The case this exists for: creatine pulls water into muscle, so the scale climbs 2-4 lb over two to three weeks while the diet is working perfectly. Without a marker, the trend chart shows a rising line during a deficit and the user concludes it stopped working. Same for a week away, where intake is guesswork and the weigh-ins are hotel-scale noise.

Set \`affects\` to what the event actually clouds — "weight" for creatine (waist stays trustworthy, which is what makes it the better measure during that window), "nutrition" for travel, "training" for an injury, "all" for something that wrecks everything. Leave it "none" for an event worth marking on the chart that does not undermine any reading.

Set \`caveat_until\` to the date the distortion lifts, which is NOT the same as \`ends_on\`. Creatine taken daily is ongoing forever — \`ends_on\` stays null — but its effect on the scale is done in about three weeks. That is what \`caveat_until\` records.

This is not a diary. An event earns a row only if it changes the reading of a number already in the log. Anything else is a note on the meal or the workout it belongs to.`,

  get_events: `Annotations on the log — supplements, travel, injuries, deloads — and which of today's readings they make unreliable.

Call this before interpreting bodyweight or a trend, and before telling the user that something is or is not working. \`clouded_readings\` lists what currently has an open caveat window; \`active\` is the events behind it, each with how many days are left. A weight trend read without checking this is how you tell someone in a deficit that their diet has stalled when they are two weeks into creatine.

Facts only. Whether to discount a reading, and by how much, is your call.`,

  correct_event: `Fix an event that was recorded wrong — the date, the label, what it affects, or when the caveat lifts. Partial: send only what is wrong. Send null for \`ends_on\` or \`caveat_until\` to clear one ("it turns out I never stopped"). Get event_id from get_events.`,

  delete_event: `Remove an event that never happened. Soft-deleted and recoverable. Prefer correct_event when the event was real but recorded wrong — deleting it loses the annotation on every reading in its window.`,

  prescribe_session: `Write down the training session you just proposed, so it survives this conversation.

Call this AFTER you have proposed a session and the user has agreed to it. Not every time a lift is mentioned, and never speculatively — a prescription is a commitment the user will read at the gym, not a thought you had.

Get the loads from get_last_performance FIRST. Never propose a weight from memory or from earlier in the conversation.

A PRESCRIPTION IS INTENT, NOT A RECORD. It never counts as a logged workout, it never appears in training history, and it must never be reported as something the user did. When the session actually happens, call log_workout with prescription_id — that logs the real sets and links the two.

Writing a second prescription for the same date replaces the first. That is the right behaviour when the plan changes; it is the wrong tool for logging two sessions in a day.`,

  get_session: `What the user is supposed to train on a given day, with the history needed to adjust it — in one call.

Call this for "what am I doing at the gym", "what's today's session", or before proposing any change to a planned workout. Returns the prescribed exercises with their target loads, plus \`last\` and \`best_ever\` for each one, so you can apply the progression rule without a second round trip.

no_prescription: true means nothing has been written down for that date. That is different from a rest day — check get_training_plan for what the day is FOR. Offer to write a session rather than implying there is nothing to do.

Returns facts and no recommendation. The next load is your call, from \`last\` and the user's own progression rule.

\`reconciliation\` appears once a workout has been linked to the prescription: what was planned against what was done, as arithmetic. Whether a miss matters is your judgement, not the number's.`,

  delete_prescription: `Remove a session that was written down and should not have been. Soft-deleted and recoverable. To CHANGE a session, call prescribe_session again for the same date — it replaces rather than duplicates.`,

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
