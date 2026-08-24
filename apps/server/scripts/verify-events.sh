#!/usr/bin/env bash
# E2 verification: prove events work end to end against a running dev server.
# Asserts on STORED ROWS and RENDERED CONTENT, not on HTTP 200s.
set -u
cd /c/delicious-macromiser/apps/server

S=$(grep '^MCP_PATH_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
V=$(grep '^APP_VIEW_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
E=$(grep '^APP_EDIT_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
B=http://127.0.0.1:8787
PASS=0; FAIL=0

rpc() { # rpc <tool> <json-args>
  curl -s -m 20 -X POST "$B/mcp/$S" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}
ck() { # ck <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$3"; PASS=$((PASS+1));
  else printf '  FAIL %-52s want=%s got=%s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}
sql() { npx wrangler d1 execute macromiser --local --json --command "$1" 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);const r=(j[0]||j).results||[];console.log(JSON.stringify(r));}catch(e){console.log('[]');}
});"; }
jqn() { node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);
    const t=j.result&&j.result.content&&j.result.content[0]&&j.result.content[0].text;
    const o=t?JSON.parse(t):j;
    let v=o; for(const k of process.argv[1].split('.')){ if(v==null)break; v=v[k]; }
    console.log(v===undefined?'undefined':(typeof v==='object'?JSON.stringify(v):String(v)));
  }catch(e){console.log('ERR:'+e.message);}
});" "$1"; }

echo "── 0. reset (this suite asserts counts, so it must be idempotent) ──"
npx wrangler d1 execute macromiser --local --command   "DELETE FROM events; DELETE FROM bodyweight;" >/dev/null 2>&1
echo "  events and bodyweight cleared"

echo "── 1. tool surface ──"
TL=$(curl -s -m 20 -X POST "$B/mcp/$S" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
for t in log_event get_events correct_event delete_event; do
  ck "$t exposed" 1 "$(printf '%s' "$TL" | grep -c "\"$t\"")"
done

echo "── 2. the transcript's actual case ──"
# Creatine started 12 days ago; clouds the scale for three weeks from the start.
# Derive from the SERVER's local date, not UTC. At 01:00 UTC the server is
# still on yesterday in America/New_York, and a UTC-computed expectation is
# off by one — the same class of bug GOTCHAS records for backfilled rows.
TODAY=$(rpc get_briefing '{}' | jqn now.local_date)
shift_day() { node -e "const d=new Date(process.argv[1]+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(process.argv[2]));console.log(d.toISOString().slice(0,10))" "$TODAY" "$1"; }
START=$(shift_day -12)
UNTIL=$(shift_day 9)
echo "  server today=$TODAY  start=$START  caveat_until=$UNTIL"
R=$(rpc log_event "{\"kind\":\"supplement\",\"label\":\"Started creatine, 5 g daily\",\"starts_on\":\"$START\",\"caveat_until\":\"$UNTIL\",\"affects\":\"weight\"}")
EID=$(printf '%s' "$R" | jqn event_id)
ck "log_event returns an id" 1 "$(printf '%s' "$EID" | grep -c '^[0-9a-f-]\{36\}$')"

echo "  stored row:"
ROW=$(sql "SELECT kind, affects, starts_on, ends_on, caveat_until FROM events WHERE id='$EID'")
echo "    $ROW"
ck "kind stored" 1 "$(printf '%s' "$ROW" | grep -c '"kind":"supplement"')"
ck "affects stored" 1 "$(printf '%s' "$ROW" | grep -c '"affects":"weight"')"
ck "ends_on stays NULL (ongoing)" 1 "$(printf '%s' "$ROW" | grep -c '"ends_on":null')"

echo "── 3. get_events ──"
GE=$(rpc get_events '{}')
ck "clouded_readings = weight" '["weight"]' "$(printf '%s' "$GE" | jqn clouded_readings)"
ck "one active event" 1 "$(printf '%s' "$GE" | jqn active | grep -o 'event\|id' | head -1 | wc -l)"
ck "caveat is open" true "$(printf '%s' "$GE" | jqn active.0.caveat_active)"
ck "days since start" 12 "$(printf '%s' "$GE" | jqn active.0.days_since_start)"
ck "days left in window" 9 "$(printf '%s' "$GE" | jqn active.0.caveat_days_left)"
ck "ongoing despite null ends_on" true "$(printf '%s' "$GE" | jqn active.0.ongoing)"

echo "── 4. get_briefing carries it (the whole point) ──"
GB=$(rpc get_briefing '{}')
ck "briefing clouded_readings" '["weight"]' "$(printf '%s' "$GB" | jqn events.clouded_readings)"
ck "bodyweight.clouded_by is non-empty" 1 "$(printf '%s' "$GB" | jqn bodyweight.clouded_by | grep -c 'creatine')"

echo "── 5. get_week_summary carries it too ──"
WS=$(rpc get_week_summary '{"days":30}')
ck "week clouded_readings" '["weight"]' "$(printf '%s' "$WS" | jqn clouded_readings)"

echo "── 6. the chart draws it ──"
# Two weigh-ins bracketing the creatine start, so the trend actually renders.
rpc log_bodyweight "{\"weight_lb\":208,\"date\":\"$START\"}" >/dev/null
D1=$(shift_day -6)
rpc log_bodyweight "{\"weight_lb\":209.4,\"date\":\"$D1\"}" >/dev/null
rpc log_bodyweight '{"weight_lb":210.1}' >/dev/null
PAGE=$(curl -s "$B/app/$V")
ck "caveat band drawn" 1 "$(printf '%s' "$PAGE" | grep -c 'class="c-caveat"')"
ck "start rule drawn" 1 "$(printf '%s' "$PAGE" | grep -c 'class="c-mark"')"
ck "event named under the chart" 1 "$(printf '%s' "$PAGE" | grep -c 'Started creatine, 5 g daily')"
ck "open caveat is called out" 1 "$(printf '%s' "$PAGE" | grep -c 'scale still settling')"
ck "events stub is gone (feature is real)" 0 "$(curl -s "$B/app/$E" | grep -c 'roadmap#events')"
ck "roadmap lists it as shipped" 1 "$(curl -s "$B/app/$V/roadmap" | grep -c 'Events and annotations')"

echo "── 7. a non-weight event must NOT be drawn on the scale ──"
R2=$(rpc log_event '{"kind":"injury","label":"Left shoulder — no overhead pressing","affects":"training","caveat_until":"2099-01-01"}')
EID2=$(printf '%s' "$R2" | jqn event_id)
PAGE2=$(curl -s "$B/app/$V")
ck "injury not on the weight chart" 0 "$(printf '%s' "$PAGE2" | grep -c 'no overhead pressing')"
ck "but training IS flagged clouded" 1 "$(rpc get_events '{}' | jqn clouded_readings | grep -c 'training')"

echo "── 8. undo ──"
CR=$(rpc correct_event "{\"event_id\":\"$EID\",\"label\":\"Creatine monohydrate, 5 g\"}")
ck "correct_event applied" 1 "$(printf '%s' "$CR" | jqn after.label | grep -c 'monohydrate')"
DL=$(rpc delete_event "{\"event_id\":\"$EID2\"}")
ck "delete_event soft-deletes" true "$(printf '%s' "$DL" | jqn deleted)"
ck "deleted row is hidden" '[]' "$(rpc get_events '{}' | jqn active | grep -c 'shoulder' | sed 's/^0$/[]/;s/^[1-9].*/PRESENT/')"
ck "row still exists in D1 (recoverable)" 1 "$(sql "SELECT id FROM events WHERE id='$EID2'" | grep -c "$EID2")"

echo "── 9. validation rejects nonsense ──"
ck "bad kind refused" 1 "$(rpc log_event '{"kind":"vibes","label":"nope"}' | grep -c 'NOT SAVED')"
ck "ends_on before starts_on refused" 1 "$(rpc log_event '{"kind":"travel","label":"backwards trip","starts_on":"2026-08-20","ends_on":"2026-08-01"}' | grep -c 'NOT SAVED')"
ck "affects=none drops the caveat date" null "$(rpc log_event '{"kind":"other","label":"bought a new scale","caveat_until":"2099-01-01"}' | jqn event.caveat_until)"
ck "unknown id refused" 1 "$(rpc correct_event '{"event_id":"nope","label":"x"}' | grep -c 'NOT CHANGED')"

echo
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
