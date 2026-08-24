#!/usr/bin/env bash
# E1 Phase 1 verification: the prescribed session.
#
# The assertion that matters most is the NEGATIVE one in section 4: a
# prescription must never appear as training history. If that ever fails, the
# product is recommending loads off sessions the user did not do.
set -u
cd "$(dirname "$0")/.."

S=$(grep '^MCP_PATH_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
V=$(grep '^APP_VIEW_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
E=$(grep '^APP_EDIT_SECRET=' .dev.vars | cut -d= -f2 | tr -d '\r')
B=http://127.0.0.1:8787
PASS=0; FAIL=0

rpc() {
  curl -s -m 20 -X POST "$B/mcp/$S" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}
ck() {
  if [ "$2" = "$3" ]; then printf '  ok   %-50s %s\n' "$1" "$3"; PASS=$((PASS+1));
  else printf '  FAIL %-50s want=%s got=%s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
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
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const r=(j[0]||j).results;console.log(JSON.stringify(r))}catch(e){console.log('[]')}})"; }

echo "── 0. reset ──"
npx wrangler d1 execute macromiser --local --command \
  "DELETE FROM prescribed_sets; DELETE FROM prescriptions; DELETE FROM sets; DELETE FROM workouts;" >/dev/null 2>&1
echo "  cleared"
TODAY=$(rpc get_briefing '{}' | jqn now.local_date)
echo "  server today=$TODAY"

echo "── 1. tool surface ──"
TL=$(curl -s -m 20 -X POST "$B/mcp/$S" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
for t in prescribe_session get_session delete_prescription; do
  ck "$t exposed" 1 "$(printf '%s' "$TL" | grep -c "\"$t\"")"
done

echo "── 2. nothing written down reads as nothing, not as rest ──"
GS=$(rpc get_session '{}')
ck "no_prescription is explicit" true "$(printf '%s' "$GS" | jqn no_prescription)"
ck "and it says what to do" 1 "$(printf '%s' "$GS" | jqn note | grep -c 'prescribe_session')"

echo "── 3. the transcript's Day B, written down ──"
R=$(rpc prescribe_session '{
  "label":"Day B — hinge + pull",
  "notes":"8 min bike, dynamic only. No static stretching up front.",
  "exercises":[
    {"exercise":"Romanian deadlift","sets":3,"rep_low":8,"target_weight_lb":115,"block":"A","notes":"Learn the hinge first"},
    {"exercise":"Bench press","sets":3,"rep_low":8,"target_weight_lb":145,"block":"B"},
    {"exercise":"Assisted wide-grip pullup","sets":3,"rep_low":8,"block":"C1"},
    {"exercise":"Dumbbell row","sets":3,"rep_low":10,"target_weight_lb":55,"block":"C2"},
    {"exercise":"Cable crunch","sets":3,"rep_low":12,"target_weight_lb":50,"block":"D1"},
    {"exercise":"Farmers carry","sets":3,"rep_low":40,"block":"E"}
  ]}')
PID=$(printf '%s' "$R" | jqn prescription_id)
ck "returns an id" 1 "$(printf '%s' "$PID" | grep -c '^[0-9a-f-]\{36\}$')"
ck "reads it back to the user" 1 "$(printf '%s' "$R" | jqn session.0 | grep -c 'Romanian deadlift 3×8 @ 115')"
ck "warns it is a plan, not a record" 1 "$(printf '%s' "$R" | jqn reminder | grep -c 'not a record')"
ck "reports the hinge is covered" 1 "$(printf '%s' "$R" | jqn movement_patterns | grep -c 'hinge')"

echo "  stored rows:"
ROWS=$(sqln "SELECT ordinal, exercise, sets, rep_low, target_weight_lb FROM prescribed_sets ORDER BY ordinal")
echo "    $(printf '%s' "$ROWS" | head -c 240)…"
ck "6 targets stored" 6 "$(printf '%s' "$ROWS" | grep -o '"ordinal"' | wc -l | tr -d ' ')"
ck "first is the normalized RDL" 1 "$(printf '%s' "$ROWS" | grep -c '"exercise":"romanian_deadlift"')"
ck "load stored" 1 "$(printf '%s' "$ROWS" | grep -c '"target_weight_lb":115')"

echo "── 4. THE CRITICAL NEGATIVE: a plan is not history ──"
LP=$(rpc get_last_performance '{"exercises":["romanian deadlift","bench press"]}')
ck "RDL has no sessions logged" 0 "$(printf '%s' "$LP" | jqn exercises.0.sessions_logged)"
ck "RDL has no last session" null "$(printf '%s' "$LP" | jqn exercises.0.last)"
ck "RDL has no best_ever" null "$(printf '%s' "$LP" | jqn exercises.0.best_ever)"
ck "bench has no history either" false "$(printf '%s' "$LP" | jqn exercises.1.has_history)"
ck "the sets table is untouched" '[]' "$(sqln 'SELECT id FROM sets')"
ck "no phantom workout row" '[]' "$(sqln 'SELECT id FROM workouts')"

echo "── 5. get_session returns plan AND history in one call ──"
GS2=$(rpc get_session '{}')
ck "6 exercises" 6 "$(printf '%s' "$GS2" | jqn exercises | grep -o '\"ordinal\"' | wc -l | tr -d ' ')"
ck "status planned" planned "$(printf '%s' "$GS2" | jqn prescription.status)"
ck "human phrasing present" 1 "$(printf '%s' "$GS2" | jqn exercises.1.reads_as | grep -c 'Bench press 3×8 @ 145')"
ck "history slot present and empty" null "$(printf '%s' "$GS2" | jqn exercises.0.last)"
ck "no reconciliation yet" null "$(printf '%s' "$GS2" | jqn reconciliation)"

echo "── 6. the page renders it ──"
PAGE=$(curl -s "$B/app/$V")
ck "session block rendered" 1 "$(printf '%s' "$PAGE" | grep -c 'class="session"')"
# Match around the em-dash: it survives the page fine but not every shell
# pipeline agrees on its encoding, and a test should fail for real reasons.
ck "label shown" 1 "$(printf '%s' "$PAGE" | grep -c 's-title\">Day B')"
ck "label's second half shown" 1 "$(printf '%s' "$PAGE" | grep -c 'hinge + pull')"
ck "a real target with its load" 1 "$(printf '%s' "$PAGE" | grep -c 'Romanian deadlift 3×8 @ 115')"
ck "marked planned" 1 "$(printf '%s' "$PAGE" | grep -c 's-planned')"
ck "session stub is gone" 0 "$(curl -s "$B/app/$E" | grep -c 'roadmap#session')"

echo "── 7. logging the session closes the loop in ONE call ──"
LW=$(rpc log_workout '{
  "session_label":"Day B",
  "sets":[
    {"exercise":"romanian deadlift","set_no":1,"reps":8,"weight_lb":115},
    {"exercise":"RDL","set_no":2,"reps":8,"weight_lb":115},
    {"exercise":"Romanian Deadlifts","set_no":3,"reps":8,"weight_lb":115},
    {"exercise":"bench press","set_no":4,"reps":8,"weight_lb":135},
    {"exercise":"leg press","set_no":5,"reps":12,"weight_lb":300}
  ]}')
ck "linked without being told the id" 1 "$(printf '%s' "$LW" | jqn prescription_id | grep -c '^[0-9a-f-]\{36\}$')"
ck "aliases reconciled — RDL met" true "$(printf '%s' "$LW" | jqn reconciliation.compared.0.met)"
ck "bench fell short of 145" false "$(printf '%s' "$LW" | jqn reconciliation.compared.1.met)"
ck "leg press flagged unplanned" '["leg_press"]' "$(printf '%s' "$LW" | jqn reconciliation.unplanned)"
ck "4 of 6 exercises skipped" 4 "$(printf '%s' "$LW" | jqn reconciliation.missed | grep -o '\"' | wc -l | tr -d ' ' | awk '{print $1/2}')"
ck "adherence 33%" 33 "$(printf '%s' "$LW" | jqn reconciliation.adherence_pct)"
ck "prescription marked completed" completed "$(rpc get_session '{}' | jqn prescription.status)"
ck "NOW there is real history" 1 "$(rpc get_last_performance '{"exercises":["rdl"]}' | jqn exercises.0.sessions_logged)"
# The class ATTRIBUTE, not the CSS rule — `.s-completed{...}` ships on every
# page, so the bare class name matches the stylesheet too.
ck "page shows it logged" 1 "$(curl -s "$B/app/$V" | grep -c 's-completed\">logged')"

echo "── 8. re-prescribing a PLANNED day replaces rather than duplicating ──"
TOM=$(node -e "const d=new Date(process.argv[1]+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);console.log(d.toISOString().slice(0,10))" "$TODAY")
rpc prescribe_session "{\"date\":\"$TOM\",\"label\":\"First draft\",\"exercises\":[{\"exercise\":\"Back squat\",\"sets\":3,\"rep_low\":8,\"target_weight_lb\":175}]}" >/dev/null
R2=$(rpc prescribe_session "{\"date\":\"$TOM\",\"label\":\"Revised\",\"exercises\":[{\"exercise\":\"Back squat\",\"sets\":4,\"rep_low\":6,\"target_weight_lb\":185}]}")
ck "reports the replacement" true "$(printf '%s' "$R2" | jqn replaced_previous)"
ck "the revision is live" "Revised" "$(rpc get_session "{\"date\":\"$TOM\"}" | jqn prescription.label)"
ck "one live prescription for that day" 1 "$(rpc get_session "{\"date\":\"$TOM\"}" | jqn exercises | grep -o '"ordinal"' | wc -l | tr -d ' ')"
ck "the superseded row is kept, not deleted" 1 "$(sqln "SELECT id FROM prescriptions WHERE local_date='$TOM' AND status='replaced'" | grep -c id)"

echo "── 8b. a completed day is NOT silently replaced ──"
R3=$(rpc prescribe_session '{"label":"Second session","exercises":[{"exercise":"Bike intervals","sets":6}]}')
ck "completed plan left alone" false "$(printf '%s' "$R3" | jqn replaced_previous)"
ck "the new one is what get_session returns" "Second session" "$(rpc get_session '{}' | jqn prescription.label)"

echo "── 9. undo ──"
NPID=$(rpc get_session '{}' | jqn prescription.prescription_id)
D=$(rpc delete_prescription "{\"prescription_id\":\"$NPID\"}")
ck "soft-deleted" true "$(printf '%s' "$D" | jqn deleted)"
ck "recoverable" true "$(printf '%s' "$D" | jqn recoverable)"
ck "row survives in D1" 1 "$(sqln "SELECT id FROM prescriptions WHERE id='$NPID'" | grep -c "$NPID")"
ck "unknown id refused" 1 "$(rpc delete_prescription '{"prescription_id":"nope"}' | grep -c 'NOT DELETED')"
ck "empty exercise list refused" 1 "$(rpc prescribe_session '{"exercises":[]}' | grep -c 'NOT SAVED')"
ck "bad prescription_id on log refused" 1 "$(rpc log_workout '{"prescription_id":"nope","sets":[{"exercise":"squat","set_no":1,"reps":5,"weight_lb":100}]}' | grep -c 'NOT SAVED')"

echo
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
