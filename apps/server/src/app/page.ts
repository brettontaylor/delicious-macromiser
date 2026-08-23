/**
 * The read-only day view, served from the Worker at /app/<view secret>.
 *
 * Two deliberate constraints:
 *
 *   1. Read only. There is no `update_entry` or `delete_entry` tool yet — those
 *      belong with the Phase 3 correction UI — so this page shows what landed
 *      and never writes. "Validate your data" here means see it, not edit it.
 *
 *   2. Its own secret, separate from MCP_PATH_SECRET. Sharing the MCP URL would
 *      hand over full write access to the log; APP_VIEW_SECRET can be shared,
 *      revoked, and rotated without touching the connector.
 *
 * Server-rendered, no client framework, no build step. Design tokens are taken
 * from macromiser.vercel.app's own stylesheet so the two read as one product.
 */

import type { Ctx } from '../db/queries.ts';
import {
  getMealsForDate,
  getGoalsAsOf,
  getBodyweightRange,
  getMealsForRange,
  listPendingCaptures,
  getTrainingPlan,
} from '../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../domain/totals.ts';
import { localDate, shiftDate } from '../util/date.ts';
import { trendChart } from './chart.ts';
import { PAGE_CSS, esc, shell } from './layout.ts';
import { nextMeal } from '../domain/mealtimes.ts';
import { planView, weekdayIndex, whenPhrase } from '../domain/plan.ts';
import { localWeekday } from '../util/date.ts';

const n0 = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : String(Math.round(v));

interface WorkoutSummary {
  local_date: string;
  session_label: string | null;
  sets: { exercise_raw: string | null; exercise: string; reps: number | null; weight_lb: number | null }[];
}

async function recentWorkouts(ctx: Ctx, start: string, end: string): Promise<WorkoutSummary[]> {
  const res = await ctx.db
    .prepare(
      `SELECT w.local_date, w.session_label, s.exercise, s.exercise_raw, s.reps, s.weight_lb
         FROM workouts w JOIN sets s ON s.workout_id = w.id
        WHERE w.user_id = ? AND w.deleted_at IS NULL AND w.local_date BETWEEN ? AND ?
        ORDER BY w.local_date DESC, s.set_no ASC`,
    )
    .bind(ctx.userId, start, end)
    .all<{
      local_date: string;
      session_label: string | null;
      exercise: string;
      exercise_raw: string | null;
      reps: number | null;
      weight_lb: number | null;
    }>();

  const byDate = new Map<string, WorkoutSummary>();
  for (const r of res.results ?? []) {
    let w = byDate.get(r.local_date);
    if (!w) {
      w = { local_date: r.local_date, session_label: r.session_label, sets: [] };
      byDate.set(r.local_date, w);
    }
    w.sets.push({ exercise: r.exercise, exercise_raw: r.exercise_raw, reps: r.reps, weight_lb: r.weight_lb });
  }
  return [...byDate.values()];
}

export interface AppOptions {
  canEdit: boolean;
  /** Needed so form actions post back to the same capability. */
  secret: string;
  /** One-shot result of the last write, from the redirect. */
  notice: string | null;
}

export async function renderApp(
  ctx: Ctx,
  dateParam: string | null,
  opts: AppOptions,
): Promise<Response> {
  const today = localDate(ctx.now, ctx.tz);
  const date = dateParam ?? today;
  const windowStart = shiftDate(date, -29);

  const [meals, goals, bw, workouts, rangeMeals, pendingCaptures, plan] = await Promise.all([
    getMealsForDate(ctx, date),
    getGoalsAsOf(ctx, date),
    getBodyweightRange(ctx, shiftDate(date, -89), date),
    recentWorkouts(ctx, windowStart, date),
    getMealsForRange(ctx, windowStart, date),
    listPendingCaptures(ctx, 10),
    getTrainingPlan(ctx),
  ]);

  const totals = sumMeals(meals);
  const remaining = remainingVsGoals(totals, goals);

  const pct = (v: number, goal: number | null | undefined): number =>
    !goal || goal <= 0 ? 0 : Math.min(v / goal, 1);

  const kcalPct = pct(totals.kcal, goals?.kcal);
  const ARC = 427.3;

  // Days that have any meal, newest first — the date picker only offers days
  // with something to look at.
  const loggedDays = [...new Set(rangeMeals.map((m) => m.local_date))].sort().reverse();

  const latestWeight = [...bw].reverse().find((r) => r.weight_lb !== null);

  const importedCount = meals.filter((m) => m.source === 'import').length;

  // The plan is about the shape of a week, so it only makes sense on today.
  const planToday = date === today ? planView(plan, weekdayIndex(localWeekday(ctx.now, ctx.tz))) : null;
  const didLiftToday = workouts.some((w) => w.local_date === date);

  // Only meaningful for today — a next meal on a day already past is noise.
  const upcoming =
    date === today
      ? nextMeal(
          rangeMeals.map((m) => ({
            local_date: m.local_date,
            logged_at: m.logged_at,
            meal_type: m.meal_type,
          })),
          ctx.now,
          ctx.tz,
        )
      : null;

  return shell(`Macromiser — ${date}`, PAGE_CSS, `

  ${
    opts.notice
      ? `<p class="notice">${
          {
            saved: 'Saved.',
            learned: 'Saved — and the portion is remembered for next time.',
            deleted: 'Deleted. The entry is recoverable.',
            nochange: 'Nothing changed.',
            gone: 'That entry is already gone.',
            missing: 'That form was missing an entry id.',
            captured: 'Captured. Your coach will pick it up next time you open a chat.',
            emptynote: 'Nothing to capture — write what you ate first.',
            longnote: 'That note is too long. Keep it under 500 characters.',
          }[opts.notice] ?? 'Done.'
        }</p>`
      : ''
  }

  <div class="bar">
    <span class="brand">Macromiser</span>
    <a class="navlink" href="/app/${esc(opts.secret)}/recipes">Recipes</a>
    <span class="ro">${opts.canEdit ? 'Editable' : 'Read only'}</span>
  </div>

  <div>
    <h1 class="date">${esc(
      new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    )}</h1>
    <p class="sub">${date === today ? 'Today' : ''}${date === today && loggedDays.length ? ' · ' : ''}${
      meals.length
    } meal${meals.length === 1 ? '' : 's'} logged${importedCount ? ` · ${importedCount} imported` : ''}</p>
  </div>

  ${
    loggedDays.length > 1
      ? `<nav class="days" aria-label="Days with entries">${loggedDays
          .slice(0, 30)
          .map(
            (d) =>
              `<a class="day" href="?date=${esc(d)}"${d === date ? ' aria-current="page"' : ''}>${esc(
                d.slice(5),
              )}</a>`,
          )
          .join('')}</nav>`
      : ''
  }

  ${
    planToday && !planToday.empty && (planToday.today || planToday.next_lift)
      ? `<section class="today">
          ${
            planToday.today
              ? `<div class="t-row">
                  <span class="t-kind t-${esc(planToday.today.kind)}">${
                    planToday.today.kind === 'lift'
                      ? esc(planToday.today.label ?? 'Lift day')
                      : planToday.today.kind === 'active'
                        ? esc(planToday.today.label ?? 'Active recovery')
                        : esc(planToday.today.label ?? 'Rest day')
                  }</span>
                  ${
                    planToday.today.kind === 'lift' && didLiftToday
                      ? '<span class="t-done">logged</span>'
                      : ''
                  }
                </div>
                ${planToday.today.notes ? `<p class="t-notes">${esc(planToday.today.notes)}</p>` : ''}`
              : ''
          }
          ${
            planToday.next_lift && !(planToday.today?.kind === 'lift')
              ? `<p class="t-next">Next lift ${esc(
                  whenPhrase(planToday.next_lift.days_away, planToday.next_lift.weekday_name),
                )}${planToday.next_lift.label ? ` — ${esc(planToday.next_lift.label)}` : ''}</p>`
              : ''
          }
        </section>`
      : ''
  }

  <div class="gauge">
    <svg viewBox="0 0 320 176" role="img" aria-label="Calories consumed against target">
      <path class="arc-t" d="M 24 160 A 136 136 0 0 1 296 160" fill="none" stroke-width="14" stroke-linecap="round"/>
      <path class="arc-f${kcalPct > 0 ? ' lit' : ''}" d="M 24 160 A 136 136 0 0 1 296 160" fill="none"
            stroke-width="14" stroke-linecap="round"
            stroke-dasharray="${ARC}" stroke-dashoffset="${(ARC * (1 - kcalPct)).toFixed(1)}"/>
    </svg>
    <div class="g-label">Calories</div>
    <div class="g-value">${Math.round(totals.kcal)}</div>
    <div class="g-goal">/ ${goals?.kcal ? Math.round(goals.kcal) + ' kcal' : 'no target set'}</div>
    ${
      remaining.kcal !== null
        ? `<div class="g-left">${
            remaining.kcal >= 0
              ? `${Math.round(remaining.kcal)} remaining`
              : `${Math.abs(Math.round(remaining.kcal))} over`
          }${totals.alcohol_kcal > 0 ? ` · ${Math.round(totals.food_kcal)} from food` : ''}</div>`
        : ''
    }
  </div>

  ${
    upcoming?.next
      ? `<div class="upnext">
          <span class="up-slot">${esc(upcoming.next.meal_type)}${
            upcoming.next.tomorrow ? ' tomorrow' : ''
          }</span>
          <span class="up-time">usually around ${esc(upcoming.next.typical_time)}</span>
          ${
            remaining.kcal !== null && remaining.kcal > 0
              ? `<span class="up-budget">${Math.round(remaining.kcal)} kcal · ${
                  remaining.protein_g !== null ? Math.round(remaining.protein_g) + ' g protein' : ''
                } left</span>`
              : ''
          }
        </div>`
      : ''
  }

  <div class="macros">
    ${(
      [
        ['Protein', totals.protein_g, goals?.protein_g],
        ['Carbs', totals.carb_g, goals?.carb_g],
        ['Fat', totals.fat_g, goals?.fat_g],
      ] as [string, number, number | null | undefined][]
    )
      .map(
        ([name, val, goal]) => `<div class="macro">
        <div class="m-name">${name}</div>
        <div class="m-num">${Math.round(val)}<span>/${goal ? Math.round(goal) : '—'}g</span></div>
        <div class="bar-t"><i style="width:${(pct(val, goal) * 100).toFixed(1)}%"></i></div>
      </div>`,
      )
      .join('')}
  </div>

  ${
    opts.canEdit
      ? `<form class="capture" method="post" action="/app/${esc(opts.secret)}/capture">
          <input type="hidden" name="date" value="${esc(date)}">
          <label class="cap-label" for="cap-note">Log a meal</label>
          <input id="cap-note" name="note" maxlength="500" autocomplete="off"
                 placeholder="8oz chicken, cup of rice, big salad">
          <button class="btn btn-primary" type="submit">Capture</button>
          <p class="hint">The app does no analysis of its own — your coach reads this
          next time you open a chat and works out the macros on your own model.</p>
        </form>`
      : ''
  }

  ${
    pendingCaptures.length > 0
      ? `<div class="pending">
          <span class="pend-n">${pendingCaptures.length}</span>
          <span class="pend-t">waiting for your coach${
            opts.canEdit
              ? `<span class="pend-list">${pendingCaptures
                  .slice(0, 3)
                  .map((c) => esc(c.note ?? c.kind))
                  .join(' · ')}</span>`
              : ''
          }</span>
        </div>`
      : ''
  }

  <section>
    <div class="head"><h2>Meals</h2><span class="count">${Math.round(totals.kcal)} kcal${
      totals.alcohol_g > 0 ? ` · ${Math.round(totals.alcohol_g)}g alcohol` : ''
    }</span></div>
    ${
      meals.length === 0
        ? `<div class="empty">Nothing logged for this day.</div>`
        : meals
            .map((m) => {
              const chips = `
          ${m.meal_type ? `<span class="chip">${esc(m.meal_type)}</span>` : ''}
          <span class="chip${m.source === 'corrected' || m.source === 'recipe' ? ' ink' : ''}">${esc(
            m.source,
          )}</span>
          <span class="chip">${esc(m.confidence)} confidence</span>
          ${m.alcohol_g > 0 ? `<span class="chip warn">${Math.round(m.alcohol_g)} g alcohol</span>` : ''}`;

              if (!opts.canEdit) {
                return `<article class="card">
        <div class="desc">${esc(m.description)}</div>
        <div class="chips">${chips}</div>
        <div class="nums">
          <span><b>${Math.round(m.kcal)}</b> kcal</span>
          <span>P <b>${Math.round(m.protein_g)}</b></span>
          <span>C <b>${Math.round(m.carb_g)}</b></span>
          <span>F <b>${Math.round(m.fat_g)}</b></span>
        </div>
      </article>`;
              }

              // A <details> keeps the day scannable: the numbers read at a
              // glance and the inputs only appear for the one you are fixing.
              return `<article class="card">
        <details>
          <summary>
            <span class="desc">${esc(m.description)}</span>
            <span class="nums">
              <span><b>${Math.round(m.kcal)}</b> kcal</span>
              <span>P <b>${Math.round(m.protein_g)}</b></span>
              <span>C <b>${Math.round(m.carb_g)}</b></span>
              <span>F <b>${Math.round(m.fat_g)}</b></span>
            </span>
            <span class="chips">${chips}</span>
          </summary>
          <form class="edit" method="post" action="/app/${esc(opts.secret)}/save">
            <input type="hidden" name="meal_id" value="${esc(m.id)}">
            <input type="hidden" name="date" value="${esc(date)}">
            <label class="wide">what it was
              <input name="description" value="${esc(m.description)}" maxlength="200">
            </label>
            <div class="grid4">
              <label>kcal<input name="kcal" type="number" inputmode="numeric" min="0" step="1" value="${Math.round(
                m.kcal,
              )}"></label>
              <label>protein<input name="protein_g" type="number" inputmode="numeric" min="0" step="1" value="${Math.round(
                m.protein_g,
              )}"></label>
              <label>carbs<input name="carb_g" type="number" inputmode="numeric" min="0" step="1" value="${Math.round(
                m.carb_g,
              )}"></label>
              <label>fat<input name="fat_g" type="number" inputmode="numeric" min="0" step="1" value="${Math.round(
                m.fat_g,
              )}"></label>
            </div>
            <p class="hint">Saving marks this corrected and teaches the portion — the next estimate of the same phrase starts here.</p>
            <div class="row">
              <button class="btn btn-primary" type="submit">Save</button>
              <button class="btn btn-ghost" type="submit"
                      formaction="/app/${esc(opts.secret)}/remove"
                      formnovalidate>Delete</button>
            </div>
          </form>
        </details>
      </article>`;
            })
            .join('')
    }
  </section>

  <section>
    <div class="head"><h2>Training</h2><span class="count">last 30 days</span></div>
    ${
      workouts.length === 0
        ? `<div class="empty">No sessions in the last 30 days.</div>`
        : workouts
            .slice(0, 6)
            .map(
              (w) => `<article class="card">
        <div class="desc">${esc(w.local_date)}${
          w.session_label ? ` · ${esc(w.session_label)}` : ''
        }</div>
        <div class="sets">${w.sets
          .slice(0, 14)
          .map(
            (s) =>
              `<span class="set">${esc(s.exercise_raw ?? s.exercise)} ${
                s.weight_lb !== null ? Math.round(s.weight_lb) + '×' : ''
              }${s.reps ?? '?'}</span>`,
          )
          .join('')}</div>
      </article>`,
            )
            .join('')
    }
  </section>

  <section>
    <div class="head"><h2>Bodyweight</h2><span class="count">${
      latestWeight ? n0(latestWeight.weight_lb) + ' lb' : 'no readings'
    }${goals?.target_weight_lb ? ` · target ${Math.round(goals.target_weight_lb)}` : ''}</span></div>
    ${trendChart(bw, goals?.target_weight_lb ?? null)}
  </section>

  <footer>
    ${
      opts.canEdit
        ? 'Editing here marks an entry <code>corrected</code> and teaches the portion, exactly as correcting it in chat does.'
        : 'Read-only. Corrections happen in chat, or from the editable link.'
    }
    Entries marked <code>import</code> were reconstructed from an earlier conversation and are
    weaker evidence than ones logged as they happened.
  </footer>
`);
}
