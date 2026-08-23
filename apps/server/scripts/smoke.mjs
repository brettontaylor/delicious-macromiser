/**
 * End-to-end smoke test against a running server.
 *
 * Walks the full MCP handshake, then drives the four ROADMAP Phase 1 exit
 * criteria as actual tool calls. Run it against `wrangler dev` before touching
 * the connector UI — a failure here is far cheaper to read than a failure
 * inside claude.ai.
 *
 *   node scripts/smoke.mjs                          # localhost:8787, dev secret
 *   node scripts/smoke.mjs <base-url> <path-secret>
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const SECRET = process.argv[3] ?? 'devsecretdevsecretdevsecretdev01';
const URL_MCP = `${BASE}/mcp/${SECRET}`;

let id = 0;
let failures = 0;

async function rpc(method, params) {
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (res.status === 202) return null;
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${method} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (body.error) throw new Error(`${method} -> JSON-RPC error ${body.error.code}: ${body.error.message}`);
  return body.result;
}

/** tools/call, unwrapping structuredContent and surfacing a tool-level error. */
async function call(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.isError) throw new Error(`${name} reported: ${r.content?.[0]?.text}`);
  return r.structuredContent ?? JSON.parse(r.content[0].text);
}

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(t) {
  console.log(`\n${t}`);
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

try {
  section(`Health — ${BASE}/health`);
  const health = await (await fetch(`${BASE}/health`)).json();
  check('health responds', health.ok === true, JSON.stringify(health));

  section('Auth boundary');
  const bad = await fetch(`${BASE}/mcp/thisisnottherightsecretatall00`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
  });
  check('wrong path secret is 404, not 401', bad.status === 404, `got ${bad.status}`);

  section('MCP handshake');
  const init = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  check('initialize negotiates a protocol', typeof init.protocolVersion === 'string', init.protocolVersion);
  check('server identifies itself', init.serverInfo?.name === 'macromiser');
  check('declares tools capability', !!init.capabilities?.tools);
  check('sends instructions', typeof init.instructions === 'string' && init.instructions.length > 0);

  const older = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's', version: '0' } });
  check('honors an older supported protocol', older.protocolVersion === '2025-06-18', older.protocolVersion);
  const unknown = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 's', version: '0' } });
  check('falls back on an unknown protocol', unknown.protocolVersion === '2025-06-18', unknown.protocolVersion);

  check('ping responds', (await rpc('ping')) !== null);

  section('Tool surface');
  const { tools } = await rpc('tools/list');
  const names = tools.map((t) => t.name).sort();
  // Assert the exact surface, not a count — a count assertion only tells you
  // the number changed, never which tool went missing.
  const EXPECTED_TOOLS = [
    'correct_meal', 'correct_workout', 'delete_meal', 'delete_workout', 'get_history', 'get_last_performance',
    'get_next_meal', 'get_pending_captures', 'get_today', 'get_training_plan',
    'get_week_summary',
    'import_days',
    'list_recipes',
    'log_bodyweight', 'log_meal', 'log_workout', 'resolve_capture',
    'set_goals', 'set_training_plan', 'spike_image',
  ];
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
  const extra = names.filter((t) => !EXPECTED_TOOLS.includes(t));
  check(
    'tool surface matches exactly',
    missing.length === 0 && extra.length === 0,
    missing.length || extra.length
      ? `missing: ${missing.join(', ') || 'none'} | unexpected: ${extra.join(', ') || 'none'}`
      : names.join(', '),
  );
  check('get_last_performance present', names.includes('get_last_performance'));
  check(
    'every tool has a description and schema',
    tools.every((t) => t.description?.length > 40 && t.inputSchema?.type === 'object'),
  );
  check(
    'no tool returns advice',
    !names.some((n) => /recommend|suggest|analyze/.test(n)),
    names.join(', '),
  );

  section('Setup');
  const goals = await call('set_goals', { kcal: 2300, protein_g: 170, fat_g: 75, carb_g: 235, target_weight_lb: 190, weekly_sessions: 3 });
  check('goals saved', goals.saved === true);

  section('Exit criterion 1 — a meal logs from a normal sentence');
  const lunch = await call('log_meal', {
    description: '12oz ground chicken, 1/4 cup farro, salad with 3 tbsp olive oil',
    kcal: 980, protein_g: 92, fat_g: 52, carb_g: 34, fiber_g: 6, confidence: 'medium', meal_type: 'lunch',
  });
  check('meal logged', lunch.logged === true);
  check('day total came back', lunch.day_totals?.kcal >= 980, JSON.stringify(lunch.day_totals));
  check('remaining computed against goals', typeof lunch.remaining?.kcal === 'number', JSON.stringify(lunch.remaining));
  check('estimate echoed for correction', lunch.stored_estimate?.kcal === 980);

  section('Alcohol separation');
  const wine = await call('log_meal', {
    description: 'two glasses of Burgundy', kcal: 250, protein_g: 0, fat_g: 0, carb_g: 8,
    alcohol_g: 30, confidence: 'medium', meal_type: 'dinner',
  });
  const alcKcal = wine.day_totals.alcohol_kcal;
  check('alcohol kcal derived at 7 kcal/g', alcKcal === 210, `got ${alcKcal}`);
  check(
    'food_kcal excludes alcohol',
    wine.day_totals.food_kcal === Math.round((wine.day_totals.kcal - alcKcal) * 10) / 10,
    JSON.stringify(wine.day_totals),
  );
  check('carbs were not inflated by ethanol', wine.day_totals.carb_g === 42, `got ${wine.day_totals.carb_g}`);

  section('Exit criterion 2 — "what am I at?" answers in one call');
  const day = await call('get_today');
  check('meals returned', day.meals.length === 2, `${day.meals.length} meals`);
  check('local date is the user tz date', day.local_date === today(), `${day.local_date} vs ${today()}`);
  check('weekday and local time present', !!day.weekday && /^\d{2}:\d{2}$/.test(day.local_time), `${day.weekday} ${day.local_time}`);
  check('remaining reported', typeof day.remaining.kcal === 'number');
  check('alcohol note raised', typeof day.alcohol_note === 'string');

  section('Exit criterion 3 — "what did I squat last time?" returns 205 x 6 x 4');
  const wk = await call('log_workout', {
    session_label: 'Day A',
    notes: 'felt good',
    sets: [1, 2, 3, 4].map((n) => ({ exercise: 'squat', set_no: n, reps: 6, weight_lb: 205, rpe: 7 })),
  });
  check('workout logged', wk.logged === true && wk.sets_logged === 4);
  check('exercise normalized to a slug', wk.exercises.includes('back_squat'), wk.exercises.join(','));
  check('no incomplete sets flagged', wk.incomplete_sets.length === 0);

  const perf = await call('get_last_performance', { exercises: ['back squat'] });
  const ex = perf.exercises[0];
  check('history found via an alias', ex.has_history === true);
  check('top set is 205 x 6', ex.last?.top_set?.weight_lb === 205 && ex.last?.top_set?.reps === 6, JSON.stringify(ex.last?.top_set));
  check('four sets returned', ex.last?.sets.length === 4);
  check('all sets completed', ex.last?.all_sets_completed === true);
  check('movement pattern classified', ex.movement_pattern === 'squat', ex.movement_pattern);
  check('one session is not enough to progress', ex.enough_history_to_progress === false);

  const none = await call('get_last_performance', { exercises: ['zercher carry'] });
  check('unknown lift returns an explicit empty, not an omission', none.exercises[0].has_history === false);

  section('Bodyweight and trends');
  const bw = await call('log_bodyweight', { weight_lb: 209.4, waist_in: 35.5 });
  check('bodyweight logged', bw.logged === true);
  check('rolling 7-day average returned, not the raw reading alone', bw.rolling_7d?.weight_avg_lb !== null);

  const waistOnly = await call('log_bodyweight', { waist_in: 35.2 });
  check('waist-only write keeps the day’s weight', waistOnly.rolling_7d.weight_readings === 1, JSON.stringify(waistOnly.rolling_7d));

  const week = await call('get_week_summary');
  check('week summary returns a window', week.days_in_window === 7);
  check('averages divide by days with data', week.days_with_data === 1, `${week.days_with_data}`);
  check('sparse week is labelled sparse', week.data_quality === 'sparse', week.data_quality);
  check('session counted', week.sessions === 1);

  section('History');
  const hist = await call('get_history', { start_date: week.start_date, end_date: week.end_date });
  check('meal days returned with totals', hist.meal_days?.[0]?.totals?.kcal > 0);
  check('workouts returned with sets', hist.workouts?.[0]?.sets?.length === 4);
  check('bodyweight returned', hist.bodyweight?.length === 1);

  section('Failure handling — a bad write must say NOT SAVED');
  const badMeal = await rpc('tools/call', {
    name: 'log_meal',
    arguments: { description: 'no macros given', confidence: 'medium' },
  });
  check('missing required arg is a tool error, not a crash', badMeal.isError === true);
  check('error text warns it was not saved', /NOT SAVED/.test(badMeal.content[0].text), badMeal.content[0].text);

  const badDate = await rpc('tools/call', { name: 'get_history', arguments: { start_date: '2026-02-30', end_date: '2026-03-01' } });
  check('impossible date rejected', badDate.isError === true);

  const badTool = await fetch(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'drop_everything', arguments: {} } }),
  });
  const badToolBody = await badTool.json();
  check('unknown tool is a JSON-RPC error', !!badToolBody.error, JSON.stringify(badToolBody).slice(0, 120));

  const noStream = await fetch(URL_MCP, { method: 'GET' });
  check('GET declines rather than hanging', noStream.status === 405, `got ${noStream.status}`);
} catch (e) {
  failures++;
  console.log(`\nABORTED — ${e.message}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
