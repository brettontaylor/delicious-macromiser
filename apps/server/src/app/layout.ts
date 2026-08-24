/**
 * The shared shell for every page the Worker renders.
 *
 * Extracted when a second page appeared. Two pages with two copies of a
 * stylesheet is how a design system starts drifting, and the whole point of
 * lifting these tokens from macromiser.vercel.app was that the two products
 * should read as one.
 */

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export const PAGE_CSS = String.raw`:root{
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
.navlink{margin-left:auto;font-size:13px;color:var(--ink);text-decoration:none;
  border-bottom:1px solid var(--line-firm);padding-bottom:1px}
.navlink + .navlink{margin-left:0}
.navlink:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.ro{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
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

/* capture */
.capture{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);
  border-radius:10px;padding:13px;background:var(--surface)}
.cap-label{font-family:var(--display);font-size:16px;font-weight:600}
.cap-photo{display:flex;align-items:center;justify-content:center;gap:8px;
  border:1px dashed var(--line-firm);border-radius:8px;padding:11px;cursor:pointer;
  font-size:14px;color:var(--muted)}
.cap-photo input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.cap-photo:focus-within{outline:2px solid var(--ink);outline-offset:2px}
.capture input{font-size:16px;border:1px solid var(--line-firm);border-radius:4px;
  padding:11px;background:var(--ground);color:var(--ink);width:100%;-webkit-appearance:none}
.capture input:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.pending{display:flex;align-items:center;gap:10px;border:1px solid var(--ink);
  border-radius:10px;padding:10px 13px;background:var(--accent);color:#111}
.pend-n{font-family:var(--display);font-size:22px;font-weight:700;line-height:1}
.pend-t{font-size:13px;display:flex;flex-direction:column;gap:2px}
.pend-list{font-family:var(--mono);font-size:11px;opacity:.75}

/* today's plan */
.today{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);
  border-left:3px solid var(--ink);border-radius:10px;padding:12px 14px;background:var(--surface)}
.t-row{display:flex;align-items:baseline;gap:8px}
.t-kind{font-family:var(--display);font-size:19px;font-weight:600}
.t-rest,.t-active{color:var(--muted)}
.t-done{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  border:1px solid var(--ink);border-radius:9999px;padding:2px 8px;margin-left:auto}
.t-notes{margin:0;font-size:14px;line-height:1.45}
.t-next{margin:0;font-family:var(--mono);font-size:12px;color:var(--muted)}

/* next meal */
.upnext{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;
  border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:var(--surface)}
.up-slot{font-family:var(--display);font-size:16px;font-weight:600;text-transform:capitalize}
.up-time{font-size:13px;color:var(--muted)}
.up-budget{font-family:var(--mono);font-size:12px;color:var(--muted);margin-left:auto}

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

/* back link — shared the moment a second page needed it */
.back{font-size:13px;color:var(--ink);text-decoration:none}
.back:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

/* roadmap placeholders.
   A planned feature is drawn in the place it will occupy, dashed and muted, and
   links to its row on /roadmap. Shown only on the editable capability — a link
   you send someone should look like a finished product, not a building site. */
.stub{display:flex;flex-direction:column;gap:6px;border:1px dashed var(--line-firm);
  border-radius:10px;padding:11px 13px;color:var(--muted);text-decoration:none}
.stub:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.stub-top{display:flex;align-items:baseline;gap:8px}
.stub-title{font-family:var(--display);font-size:15px;font-weight:600;color:var(--muted)}
.stub-tag{margin-left:auto;font-family:var(--mono);font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;border:1px solid var(--line-firm);border-radius:9999px;padding:2px 7px}
.stub-preview{font-family:var(--mono);font-size:11.5px;line-height:1.5;opacity:.75}

footer{border-top:1px solid var(--line);padding-top:16px;font-size:12px;color:var(--muted)}
footer code{font-family:var(--mono);background:var(--chrome);color:var(--ink);padding:1px 5px;border-radius:3px}`;

/** Wraps body content in the document. The URL carries a secret, so every page
 *  is no-store, no-referrer and noindex without the caller having to remember. */
export function shell(title: string, css: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${css}</style>
</head>
<body>
<main class="shell">
${body}
</main>
</body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
  );
}
