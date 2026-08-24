/**
 * Bodyweight and waist trend, as inline SVG. No chart library — a line, a band
 * and some dots is not worth 40kB over a phone connection.
 *
 * The design point: a single weigh-in is noise, and COACHING-LAYER.md §5
 * requires the Skill to quote the rolling average rather than the raw reading.
 * The chart says the same thing visually — raw readings are faint dots, the
 * 7-day rolling average is the line your eye follows. Nothing here invents a
 * value for a day with no reading; gaps stay gaps.
 */

import type { EventRow } from '../domain/events.ts';
import { caveatActive, inWindow } from '../domain/events.ts';
import { esc } from './layout.ts';

export interface Reading {
  local_date: string;
  weight_lb: number | null;
  waist_in: number | null;
}

interface Point {
  x: number;
  y: number;
  value: number;
  date: string;
}

const W = 320;
const H = 132;
const PAD_L = 30;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 18;

function dayNumber(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ) / 86_400_000;
}

/** Centre-less trailing mean over a `days`-wide window, by date not by index —
 *  so a gap in logging widens the window rather than silently compressing it. */
function rollingMean(rows: { d: number; v: number }[], days: number): { d: number; v: number }[] {
  return rows.map((row) => {
    const from = row.d - (days - 1);
    const window = rows.filter((r) => r.d >= from && r.d <= row.d);
    return { d: row.d, v: window.reduce((a, r) => a + r.v, 0) / window.length };
  });
}

function series(readings: Reading[], key: 'weight_lb' | 'waist_in') {
  return readings
    .filter((r) => r[key] !== null)
    .map((r) => ({ d: dayNumber(r.local_date), v: r[key] as number, date: r.local_date }));
}

export function trendChart(
  readings: Reading[],
  targetWeight: number | null,
  events: EventRow[] = [],
): string {
  const weight = series(readings, 'weight_lb');
  const waist = series(readings, 'waist_in');

  if (weight.length < 2) {
    return `<div class="empty">Two weigh-ins are needed before a trend means anything.${
      weight.length === 1 ? ' One so far.' : ''
    }</div>`;
  }

  const avg = rollingMean(weight.map(({ d, v }) => ({ d, v })), 7);
  const first = avg[0]!.v;
  const last = avg[avg.length - 1]!.v;
  const delta = last - first;

  const dMin = Math.min(...weight.map((p) => p.d));
  const dMax = Math.max(...weight.map((p) => p.d));
  const dSpan = dMax - dMin || 1;

  // Scale to the DATA, never to the target. A goal 20 lb away would otherwise
  // squeeze every real reading into a strip at the top of the frame and hide
  // the only thing the chart exists to show — which way the line is going.
  // The target is drawn when it happens to fall in range, and annotated at the
  // edge when it does not.
  const values = [...weight.map((p) => p.v), ...avg.map((p) => p.v)];
  const raw = { lo: Math.min(...values), hi: Math.max(...values) };
  // A minimum 4 lb window stops day-to-day water weight reading as a cliff.
  const pad = Math.max(1, (4 - (raw.hi - raw.lo)) / 2);
  const vMin = raw.lo - pad;
  const vMax = raw.hi + pad;
  const vSpan = vMax - vMin || 1;

  const x = (d: number) => PAD_L + ((d - dMin) / dSpan) * (W - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - vMin) / vSpan) * (H - PAD_T - PAD_B);

  // Event markers. The whole reason events exist: a rising 7-day average during
  // a deficit is alarming until you can see that creatine started two weeks ago.
  // Only events that touch weight are drawn — an injury does not explain the
  // scale, and a chart that implies it would be worse than no marker at all.
  const firstDate = weight[0]!.date;
  const lastDate = weight[weight.length - 1]!.date;
  const marks = inWindow(events, firstDate, lastDate)
    .filter((e) => e.affects === 'weight' || e.affects === 'all')
    .map((e) => {
      const at = e.starts_on < firstDate ? firstDate : e.starts_on;
      // The caveat window, clipped to the drawn range.
      const until = e.caveat_until && e.caveat_until < lastDate ? e.caveat_until : lastDate;
      return {
        e,
        x1: x(dayNumber(at)),
        x2: e.caveat_until ? x(dayNumber(until)) : null,
        onScale: e.starts_on >= firstDate,
      };
    });

  const bands = marks
    .filter((m) => m.x2 !== null && m.x2! > m.x1)
    .map(
      (m) =>
        `<rect class="c-caveat" x="${m.x1.toFixed(1)}" y="${PAD_T}" width="${(
          m.x2! - m.x1
        ).toFixed(1)}" height="${(H - PAD_T - PAD_B).toFixed(1)}"/>`,
    )
    .join('');

  const rules = marks
    .filter((m) => m.onScale)
    .map(
      (m) =>
        `<line class="c-mark" x1="${m.x1.toFixed(1)}" x2="${m.x1.toFixed(1)}" y1="${PAD_T}" y2="${
          H - PAD_B
        }"/>`,
    )
    .join('');

  const pts: Point[] = weight.map((p) => ({ x: x(p.d), y: y(p.v), value: p.v, date: p.date }));
  const avgPath = avg.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');

  let targetLine = '';
  if (targetWeight !== null) {
    if (targetWeight >= vMin && targetWeight <= vMax) {
      targetLine = `<line class="c-target" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(
        targetWeight,
      ).toFixed(1)}" y2="${y(targetWeight).toFixed(1)}"/>
        <text class="c-tick" x="${W - PAD_R}" y="${(y(targetWeight) - 4).toFixed(
          1,
        )}" text-anchor="end">target ${Math.round(targetWeight)}</text>`;
    } else {
      // Off-scale: say which way and how far, rather than distorting the axis.
      const below = targetWeight < vMin;
      targetLine = `<text class="c-tick" x="${W - PAD_R}" y="${
        below ? H - PAD_B - 3 : PAD_T + 8
      }" text-anchor="end">target ${Math.round(targetWeight)} · ${Math.abs(
        last - targetWeight,
      ).toFixed(1)} lb ${below ? 'below' : 'above'}</text>`;
    }
  }

  const waistNote =
    waist.length >= 2
      ? (() => {
          const wDelta = waist[waist.length - 1]!.v - waist[0]!.v;
          return `<span class="c-waist">waist ${waist[waist.length - 1]!.v.toFixed(1)}″ (${
            wDelta === 0 ? 'flat' : `${wDelta > 0 ? '+' : ''}${wDelta.toFixed(1)}″`
          })</span>`;
        })()
      : '';

  return `
  <div class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Bodyweight over ${weight.length} readings from ${weight[0]!.date} to ${
           weight[weight.length - 1]!.date
         }: ${first.toFixed(1)} to ${last.toFixed(1)} pounds on a 7-day average.">
      <line class="c-axis" x1="${PAD_L}" x2="${W - PAD_R}" y1="${H - PAD_B}" y2="${H - PAD_B}"/>
      <text class="c-tick" x="${PAD_L - 5}" y="${(y(vMax - 1) + 3).toFixed(1)}" text-anchor="end">${Math.round(
        vMax - 1,
      )}</text>
      <text class="c-tick" x="${PAD_L - 5}" y="${(y(vMin + 1) + 3).toFixed(1)}" text-anchor="end">${Math.round(
        vMin + 1,
      )}</text>
      ${bands}
      ${rules}
      ${targetLine}
      ${pts.map((p) => `<circle class="c-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2"/>`).join('')}
      <path class="c-avg" d="${avgPath}" fill="none"/>
      <circle class="c-last" cx="${x(avg[avg.length - 1]!.d).toFixed(1)}" cy="${y(last).toFixed(
        1,
      )}" r="3.5"/>
    </svg>
    <div class="c-legend">
      <span><b>${last.toFixed(1)} lb</b> 7-day avg</span>
      <span class="${delta <= 0 ? 'c-down' : 'c-up'}">${
        delta === 0 ? 'flat' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lb`
      } over ${Math.round(dSpan)} days</span>
      ${waistNote}
    </div>
    ${
      marks.length > 0
        ? `<div class="c-events">${marks
            .map((m) => {
              const open = caveatActive(m.e, lastDate);
              return `<span class="c-event${open ? ' lit' : ''}">${esc(m.e.label)}${
                open ? ' — scale still settling' : ''
              }</span>`;
            })
            .join('')}</div>`
        : ''
    }
  </div>`;
}
