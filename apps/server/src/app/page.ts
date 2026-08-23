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
} from '../db/queries.ts';
import { sumMeals, remainingVsGoals } from '../domain/totals.ts';
import { localDate, shiftDate } from '../util/date.ts';
import { trendChart } from './chart.ts';

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

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

  const [meals, goals, bw, workouts, rangeMeals] = await Promise.all([
    getMealsForDate(ctx, date),
    getGoalsAsOf(ctx, date),
    getBodyweightRange(ctx, shiftDate(date, -89), date),
    recentWorkouts(ctx, windowStart, date),
    getMealsForRange(ctx, windowStart, date),
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

  const html = `<!doctype html>
<html lang="en" data-date="${esc(date)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Macromiser — ${esc(date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{
  --gray-100:#111;--gray-70:#676767;--gray-30:#c9c9c9;--gray-20:#e8e8e8;--gray-10:#f6f6f4;
  --white:#fff;--accent:#ff0;
  --ink:var(--gray-100);--muted:var(--gray-70);--line:var(--gray-20);--line-firm:var(--gray-30);
  --ground:var(--gray-10);--surface:var(--white);--track:#e5e5e5;--fill:var(--gray-100);
  --chrome:#eeeeec;--scrim:rgba(17,17,17,.07);
  --display:"Archivo","PP Right Grotesk",system-ui,sans-serif;
  --ui:"Inter","PP Neue Montreal",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ink:#f4f4f1;--muted:#9a9a95;--line:#2e2e2b;--line-firm:#3d3d39;--ground:#121211;
  --surface:#1b1b19;--track:#302f2c;--fill:#f4f4f1;--chrome:#2a2a27;--scrim:rgba(244,244,241,.08);
}}
:root[data-theme="dark"]{
  --ink:#f4f4f1;--muted:#9a9a95;--line:#2e2e2b;--line-firm:#3d3d39;--ground:#121211;
  --surface:#1b1b19;--track:#302f2c;--fill:#f4f4f1;--chrome:#2a2a27;--scrim:rgba(244,244,241,.08);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--ui);line-height:1.5;
  -webkit-font-smoothing:antialiased;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.shell{max-width:460px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:24px}
.bar{display:flex;align-items:center;gap:8px}
.brand{font-family:var(--display);font-weight:600;font-size:17px;letter-spacing:.01em}
.ro{margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);border:1px solid var(--line-firm);border-radius:9999px;padding:3px 9px}
h1.date{font-family:var(--display);font-size:26px;font-weight:500;margin:0;letter-spacing:.01em}
.sub{font-family:var(--mono);font-size:12px;color:var(--muted);margin:2px 0 0}

.gauge{display:flex;flex-direction:column;align-items:center}
.gauge svg{width:min(100%,300px);height:auto;display:block;overflow:visible}
.arc-t{stroke:var(--track)}
.arc-f{stroke:var(--fill)}
.arc-f.lit{filter:drop-shadow(0 0 7px var(--accent)) drop-shadow(0 0 2px var(--accent))}
.g-label{font-size:15px;margin-top:-126px}
.g-value{font-family:var(--display);font-weight:600;font-size:52px;line-height:1.05;font-variant-numeric:tabular-nums}
.g-goal{font-family:var(--mono);font-size:13px;color:var(--muted)}
.g-left{font-size:13px;color:var(--muted);margin-top:6px}

.macros{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.macro{display:flex;flex-direction:column;gap:8px;text-align:center}
.m-name{font-size:14px}
.m-num{font-family:var(--display);font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.m-num span{color:var(--muted);font-size:13px;font-weight:400}
.bar-t{height:4px;border-radius:9999px;background:var(--track);overflow:hidden}
.bar-t i{display:block;height:100%;background:var(--fill);border-radius:9999px}

section{display:flex;flex-direction:column;gap:12px}
h2{font-family:var(--display);font-size:17px;font-weight:600;margin:0}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.count{font-family:var(--mono);font-size:11px;color:var(--muted)}

.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;
  display:flex;flex-direction:column;gap:8px}
.desc{font-size:14px;line-height:1.4}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
  border:1px solid var(--line-firm);border-radius:9999px;padding:2px 8px;color:var(--muted);white-space:nowrap}
.chip.ink{border-color:var(--ink);color:var(--ink)}
.chip.warn{border-color:var(--ink);background:var(--accent);color:#111}
.nums{display:flex;flex-wrap:wrap;gap:4px 16px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.nums b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}
.sets{display:flex;flex-wrap:wrap;gap:4px}
.set{font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:4px;
  padding:2px 8px;font-variant-numeric:tabular-nums}
.empty{border:1px dashed var(--line-firm);border-radius:10px;padding:20px 16px;text-align:center;
  color:var(--muted);font-size:13px}

/* chart */
.chart{display:flex;flex-direction:column;gap:8px}
.chart svg{width:100%;height:auto;display:block}
.c-axis{stroke:var(--line);stroke-width:1}
.c-target{stroke:var(--line-firm);stroke-width:1;stroke-dasharray:3 3}
.c-tick{font-family:var(--mono);font-size:8px;fill:var(--muted)}
.c-dot{fill:var(--line-firm)}
.c-avg{stroke:var(--fill);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.c-last{fill:var(--fill);stroke:var(--surface);stroke-width:1.5}
.c-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-family:var(--mono);font-size:11px;color:var(--muted)}
.c-legend b{color:var(--ink);font-weight:500;font-family:var(--ui);font-size:13px}
.c-down{color:var(--ink)}
.c-waist{opacity:.85}

/* editing */
.notice{margin:0;padding:9px 12px;border:1px solid var(--line-firm);border-radius:8px;
  background:var(--surface);font-size:13px}
details summary{cursor:pointer;list-style:none;display:flex;flex-direction:column;gap:8px}
details summary::-webkit-details-marker{display:none}
details summary::after{content:"Edit";font-family:var(--mono);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);border:1px solid var(--line-firm);
  border-radius:9999px;padding:2px 8px;align-self:flex-start}
details[open] summary::after{content:"Close"}
details summary:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:6px}
.edit{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;
  border-top:1px dashed var(--line-firm)}
.edit label{display:flex;flex-direction:column;gap:4px;font-family:var(--mono);font-size:10px;
  letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.edit input{font-family:var(--mono);font-size:14px;border:1px solid var(--line-firm);
  border-radius:4px;padding:8px;background:var(--ground);color:var(--ink);width:100%;
  -webkit-appearance:none}
.edit input:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.hint{margin:0;font-size:12px;color:var(--muted);line-height:1.4}
.row{display:flex;gap:8px}
.btn{flex:1;font-family:var(--ui);font-size:14px;font-weight:500;border-radius:50px;
  padding:11px 16px;cursor:pointer;border:1px solid var(--ink)}
.btn-primary{background:var(--ink);color:var(--ground)}
.btn-ghost{background:transparent;color:var(--ink)}
.btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
@media (max-width:400px){.grid4{grid-template-columns:repeat(2,1fr)}}

.days{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
.day{flex:0 0 auto;font-family:var(--mono);font-size:12px;text-decoration:none;color:var(--ink);
  border:1px solid var(--line-firm);border-radius:9999px;padding:5px 11px;white-space:nowrap}
.day[aria-current="page"]{background:var(--ink);color:var(--ground);border-color:var(--ink)}
.day:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

footer{border-top:1px solid var(--line);padding-top:16px;font-size:12px;color:var(--muted)}
footer code{font-family:var(--mono);background:var(--chrome);color:var(--ink);padding:1px 5px;border-radius:3px}
</style>
</head>
<body>
<main class="shell">

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
          }[opts.notice] ?? 'Done.'
        }</p>`
      : ''
  }

  <div class="bar">
    <span class="brand">Macromiser</span>
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
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The URL contains a secret. Keep it out of caches and out of referrers.
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
