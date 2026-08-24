/**
 * The roadmap, in the app.
 *
 * Two reasons this exists rather than living only in docs/ROADMAP.md. The
 * greyed placeholders scattered through the app need somewhere to point — a
 * stub that explains nothing is just clutter. And the state of the build is
 * worth being able to check from a phone without a terminal.
 *
 * Read-only under both capabilities. Nothing here is personal: it is the same
 * plan the public repo already carries.
 */

import { PAGE_CSS, esc, shell } from './layout.ts';
import { byStatus, roadmapCounts, type RoadmapItem } from '../domain/roadmap.ts';

function chips(item: RoadmapItem): string {
  const out: string[] = [];
  if (item.epic) out.push(item.epic);
  if (item.size) out.push(item.size);
  for (const s of item.stories ?? []) out.push(s);
  return out.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
}

export function renderRoadmap(secret: string): Response {
  const counts = roadmapCounts();
  const shipped = byStatus('shipped');
  const next = byStatus('next');
  const gated = byStatus('gated');

  const body = `
  <div class="bar">
    <a class="back" href="/app/${esc(secret)}">&larr; Today</a>
    <span class="ro">Roadmap</span>
  </div>

  <div>
    <h1 class="date">What’s coming</h1>
    <p class="sub">${counts.shipped} shipped · ${counts.next} planned · ${counts.gated} gated</p>
  </div>

  <section>
    <div class="head"><h2>Next</h2><span class="count">in order</span></div>
    ${next
      .map(
        (item) => `<article class="card rm-item" id="${esc(item.id)}">
      <div class="rm-top">
        <span class="rm-num">${item.rank}</span>
        <span class="rm-title">${esc(item.title)}</span>
      </div>
      <p class="rm-blurb">${esc(item.blurb)}</p>
      <div class="chips">${chips(item)}</div>
    </article>`,
      )
      .join('')}
  </section>

  <section>
    <div class="head"><h2>Gated</h2><span class="count">waiting on something</span></div>
    ${gated
      .map(
        (item) => `<article class="card rm-gated" id="${esc(item.id)}">
      <div class="rm-top"><span class="rm-title">${esc(item.title)}</span></div>
      <p class="rm-blurb">${esc(item.blurb)}</p>
      <div class="chips"><span class="chip">${esc(item.blocked_by ?? 'gated')}</span></div>
    </article>`,
      )
      .join('')}
  </section>

  <section>
    <div class="head"><h2>Shipped</h2><span class="count">${counts.shipped} so far</span></div>
    <ul class="rm-done">
      ${shipped
        .map(
          (item) => `<li id="${esc(item.id)}">
        <span class="rm-tick" aria-hidden="true">✓</span>
        <span class="rm-done-t">${esc(item.title)}<span class="rm-done-b">${esc(item.blurb)}</span></span>
        <span class="rm-when">${esc(item.shipped_on ?? '')}</span>
      </li>`,
        )
        .join('')}
    </ul>
  </section>

  <footer>
    Planned items also appear greyed in place throughout the app, where the
    feature will actually live.
  </footer>
`;

  return shell('Macromiser — Roadmap', PAGE_CSS + ROADMAP_CSS, body);
}

const ROADMAP_CSS = `
.rm-item{gap:7px}
.rm-top{display:flex;align-items:baseline;gap:9px}
.rm-num{font-family:var(--display);font-size:12px;font-weight:700;flex:0 0 auto;
  min-width:20px;height:20px;border-radius:9999px;border:1px solid var(--ink);color:var(--ink);
  display:inline-flex;align-items:center;justify-content:center}
.rm-title{font-family:var(--display);font-size:16px;font-weight:600}
.rm-blurb{margin:0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.rm-gated{border-style:dashed;gap:7px}
.rm-gated .rm-title{color:var(--muted)}
.rm-done{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rm-done li{display:flex;align-items:baseline;gap:9px;padding:8px 0;border-bottom:1px solid var(--line)}
.rm-done li:last-child{border-bottom:0}
.rm-tick{font-size:12px;flex:0 0 auto}
.rm-done-t{display:flex;flex-direction:column;gap:1px;font-size:14px}
.rm-done-b{font-size:12px;color:var(--muted);line-height:1.4}
.rm-when{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted);white-space:nowrap}`;
