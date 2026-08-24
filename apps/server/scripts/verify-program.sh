#!/usr/bin/env bash
# E1 Phase 2 verification: the multi-week block.
#
# Stores the source transcript's real two-week A/B/C programme and proves the
# thing it exists for: week 1 squats at 175, week 2 at 185, and day 15 says the
# block is over rather than serving week 2 forever.
set -u
cd "$(dirname "$0")/.."

S=$(grep '^MCP_PATH_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
B=http://127.0.0.1:8787
PASS=0; FAIL=0

rpc() {
  curl -s -m 20 -X POST "$B/mcp/$S" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}
ck() {
  if [ "$2" = "$3" ]; then printf '  ok   %-52s %s\n' "$1" "$3"; PASS=$((PASS+1));
  else printf '  FAIL %-52s want=%s got=%s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}
jqn() { node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);
    const t=j.result&&j.result.content&&j.result.content[0]&&j.result.content[0].text;
    const o=t?JSON.parse(t):j;
    let v=o; for(const k of process.argv[1].split('.')){ if(v==null)break; v=v[k]; }
    console.log(v===undefined?'undefined':(typeof v==='object'?JSON.stringify(v):String(v)));
  }catch(e){console.log('ERR:'+e.message);}
});" "$1"; }
sqln() { npx wrangler d1 execute macromiser --local --json --command "$1" 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(JSON.stringify((j[0]||j).results))}catch(e){console.log('[]')}})"; }

echo "── 0. reset ──"
npx wrangler d1 execute macromiser --local --command \
  "DELETE FROM program_exercises; DELETE FROM program_days; DELETE FROM programs; DELETE FROM prescribed_sets; DELETE FROM prescriptions; DELETE FROM sets; DELETE FROM workouts;" >/dev/null 2>&1
echo "  cleared"
TODAY=$(rpc get_briefing '{}' | jqn now.local_date)
shift_day() { node -e "const d=new Date(process.argv[1]+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(process.argv[2]));console.log(d.toISOString().slice(0,10))" "$TODAY" "$1"; }
# Start the block on today so week arithmetic is anchored to a known day.
WEEK2=$(shift_day 7); PAST_END=$(shift_day 14)
echo "  today=$TODAY  week2=$WEEK2  past_end=$PAST_END"
WD=$(node -e "console.log(new Date(process.argv[1]+'T12:00:00Z').getUTCDay())" "$TODAY")
echo "  block trains weekday $WD (today) only"

echo "── 1. tool surface ──"
TL=$(curl -s -m 20 -X POST "$B/mcp/$S" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
for t in set_program get_program end_program; do
  ck "$t exposed" 1 "$(printf '%s' "$TL" | grep -c "\"$t\"")"
done

echo "── 2. no block reads as no block, not as rest ──"
ck "no_program_set explicit" true "$(rpc get_program '{}' | jqn no_program_set)"

echo "── 3. the transcript's two-week block ──"
R=$(rpc set_program "{
  \"name\":\"Hinge + hypertrophy block\",
  \"weeks\":2,
  \"started_on\":\"$TODAY\",
  \"progression_rule\":\"All reps on all sets → +5 lb upper / +10 lb lower. Miss reps → repeat the weight.\",
  \"days\":[{
    \"weekday\":$WD,\"day_key\":\"A\",\"label\":\"Squat + vertical push + core\",
    \"exercises\":[
      {\"exercise\":\"Back squat\",\"sets\":4,\"rep_low\":6,\"target_weight_lb\":175},
      {\"exercise\":\"Back squat\",\"sets\":4,\"rep_low\":6,\"target_weight_lb\":185,\"week\":2},
      {\"exercise\":\"DB shoulder press\",\"sets\":3,\"rep_low\":8,\"target_weight_lb\":35},
      {\"exercise\":\"Hanging knee raise\",\"sets\":3,\"rep_low\":10},
      {\"exercise\":\"Plank\",\"sets\":3}
    ]}]}")
ck "saved" true "$(printf '%s' "$R" | jqn saved)"
ck "end date derived inclusively" "$(shift_day 13)" "$(printf '%s' "$R" | jqn ends_on)"
ck "week shape counts 4, not 5" 4 "$(printf '%s' "$R" | jqn week_shape.0.exercises)"
ck "rule stored verbatim" 1 "$(rpc get_program '{}' | jqn program.progression_rule | grep -c 'Miss reps')"
ck "5 template rows in D1" 5 "$(sqln 'SELECT id FROM program_exercises' | grep -o '"id"' | wc -l | tr -d ' ')"
ck "the week-2 row carries offset 1" 1 "$(sqln 'SELECT week_offset FROM program_exercises WHERE week_offset IS NOT NULL' | grep -c '"week_offset":1')"

echo "── 4. THE POINT: week 1 is 175, week 2 is 185 ──"
GP=$(rpc get_program '{}')
ck "today is week 1 of 2" 1 "$(printf '%s' "$GP" | jqn program.week_of)"
ck "not expired" false "$(printf '%s' "$GP" | jqn program.expired)"
ck "week 1 squat @ 175" 1 "$(printf '%s' "$GP" | jqn days.0.exercises.0.reads_as | grep -c 'Back squat 4×6 @ 175')"
GS=$(rpc get_session '{}')
ck "session offers the template" true "$(printf '%s' "$GS" | jqn from_program.trains_today)"
ck "…without writing it" true "$(printf '%s' "$GS" | jqn no_prescription)"
ck "…at the week-1 load" 175 "$(printf '%s' "$GS" | jqn from_program.suggested.0.target.target_weight_lb)"
ck "…with history beside it" null "$(printf '%s' "$GS" | jqn from_program.suggested.0.last)"
ck "…and the rule to apply" 1 "$(printf '%s' "$GS" | jqn from_program.progression_rule | grep -c '+10 lb lower')"
GS2=$(rpc get_session "{\"date\":\"$WEEK2\"}")
ck "week 2 squat @ 185" 185 "$(printf '%s' "$GS2" | jqn from_program.suggested.0.target.target_weight_lb)"
ck "week 2 reports week 2" 2 "$(printf '%s' "$GS2" | jqn from_program.week_of)"
ck "week 2 lists 4 lifts, not 5" 4 "$(printf '%s' "$GS2" | jqn from_program.suggested | grep -o '"exercise"' | wc -l | tr -d ' ')"

echo "── 5. past the end the block is OVER, not stuck on week 2 ──"
GS3=$(rpc get_session "{\"date\":\"$PAST_END\"}")
ck "expired" true "$(printf '%s' "$GS3" | jqn from_program.expired)"
ck "week_of is null" null "$(printf '%s' "$GS3" | jqn from_program.week_of)"
ck "nothing suggested" 0 "$(printf '%s' "$GS3" | jqn from_program.suggested | grep -o '"exercise"' | wc -l | tr -d ' ')"
ck "prescribing from it is refused" 1 "$(rpc prescribe_session "{\"date\":\"$PAST_END\",\"from_program\":true}" | grep -c 'NOT SAVED')"

echo "── 6. from_program writes a real prescription ──"
P=$(rpc prescribe_session '{"from_program":true}')
ck "prescribed" true "$(printf '%s' "$P" | jqn prescribed)"
ck "credits the block" "Hinge + hypertrophy block" "$(printf '%s' "$P" | jqn from_program)"
ck "label taken from the day" 1 "$(rpc get_session '{}' | jqn prescription.label | grep -c 'Squat + vertical push')"
# Count array ITEMS, not a substring that happens to appear in most of them —
# "Hanging knee raise 3×10" has neither an @ nor the word "sets".
ck "4 targets written" 4 "$(printf '%s' "$P" | jqn session | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
ck "the week-1 load landed" 1 "$(printf '%s' "$P" | jqn session.0 | grep -c '175')"
ck "now it IS written down" false "$(rpc get_session '{}' | jqn no_prescription)"
ck "and STILL not history" 0 "$(rpc get_last_performance '{"exercises":["back squat"]}' | jqn exercises.0.sessions_logged)"

echo "── 7. the loop closes ──"
LW=$(rpc log_workout '{"sets":[
  {"exercise":"back squat","set_no":1,"reps":6,"weight_lb":175},
  {"exercise":"back squat","set_no":2,"reps":6,"weight_lb":175},
  {"exercise":"back squat","set_no":3,"reps":6,"weight_lb":175},
  {"exercise":"back squat","set_no":4,"reps":6,"weight_lb":175},
  {"exercise":"db shoulder press","set_no":5,"reps":8,"weight_lb":35},
  {"exercise":"db shoulder press","set_no":6,"reps":8,"weight_lb":35},
  {"exercise":"db shoulder press","set_no":7,"reps":8,"weight_lb":35}
]}')
ck "linked to the block's session" 1 "$(printf '%s' "$LW" | jqn prescription_id | grep -c '^[0-9a-f-]\{36\}$')"
ck "squat target met" true "$(printf '%s' "$LW" | jqn reconciliation.compared.0.met)"
ck "core work missed" 2 "$(printf '%s' "$LW" | jqn reconciliation.missed | grep -o '"' | wc -l | tr -d ' ' | awk '{print $1/2}')"
ck "adherence 50%" 50 "$(printf '%s' "$LW" | jqn reconciliation.adherence_pct)"

echo "── 8. replacing and ending a block ──"
R2=$(rpc set_program "{\"name\":\"Deload week\",\"weeks\":1,\"started_on\":\"$TODAY\",\"days\":[{\"weekday\":$WD,\"exercises\":[{\"exercise\":\"Back squat\",\"sets\":2,\"rep_low\":5,\"target_weight_lb\":135}]}]}")
ck "retires the previous block" true "$(printf '%s' "$R2" | jqn replaced_previous)"
ck "only one active" 1 "$(sqln "SELECT id FROM programs WHERE status='active'" | grep -o '"id"' | wc -l | tr -d ' ')"
ck "the old one is kept" 1 "$(sqln "SELECT id FROM programs WHERE status='completed'" | grep -o '"id"' | wc -l | tr -d ' ')"
E=$(rpc end_program '{"status":"abandoned"}')
ck "abandoned honestly" abandoned "$(printf '%s' "$E" | jqn status)"
ck "back to no active block" true "$(rpc get_program '{}' | jqn no_program_set)"
ck "ending twice is refused" 1 "$(rpc end_program '{}' | grep -c 'NOT CHANGED')"

echo "── 9. validation ──"
ck "duplicate weekday refused" 1 "$(rpc set_program '{"name":"Dupes","days":[{"weekday":"Monday","exercises":[{"exercise":"squat"}]},{"weekday":1,"exercises":[{"exercise":"bench"}]}]}' | grep -c 'NOT SAVED')"
ck "bad weekday refused" 1 "$(rpc set_program '{"name":"Bad day","days":[{"weekday":"Blursday","exercises":[{"exercise":"squat"}]}]}' | grep -c 'weekday must be')"
ck "empty exercises refused" 1 "$(rpc set_program '{"name":"Empty","days":[{"weekday":"Monday","exercises":[]}]}' | grep -c 'non-empty')"
ck "weeks out of range refused" 1 "$(rpc set_program '{"name":"Forever","weeks":99,"days":[{"weekday":"Monday","exercises":[{"exercise":"squat"}]}]}' | grep -c 'NOT SAVED')"

echo
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
