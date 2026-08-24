#!/usr/bin/env bash
# E6 verification: intra-day pace, lifetime bests, and the share affordance.
# Asserts on stored rows and rendered content. Clears its own tables first —
# every assertion here is a count or a comparison, so it must be idempotent.
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

echo "── 0. reset ──"
npx wrangler d1 execute macromiser --local --command \
  "DELETE FROM sets; DELETE FROM workouts; DELETE FROM meals;" >/dev/null 2>&1
echo "  meals and workouts cleared"

TODAY=$(rpc get_briefing '{}' | jqn now.local_date)
shift_day() { node -e "const d=new Date(process.argv[1]+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+Number(process.argv[2]));console.log(d.toISOString().slice(0,10))" "$TODAY" "$1"; }
echo "  server today=$TODAY"

echo "── 1. pace declines to guess without enough history ──"
rpc log_meal '{"description":"protein shake","kcal":130,"protein_g":20,"fat_g":2,"carb_g":8,"confidence":"medium"}' >/dev/null
P=$(rpc get_today '{}')
ck "typical is null" null "$(printf '%s' "$P" | jqn pace.typical_protein_g)"
ck "days_compared is 0" 0 "$(printf '%s' "$P" | jqn pace.days_compared)"
ck "reason is stated" 1 "$(printf '%s' "$P" | jqn pace.reason | grep -c 'comparable\|imported')"
ck "logged_at now exposed" 1 "$(printf '%s' "$P" | jqn meals.0.logged_at | grep -c '^20')"

echo "── 2. backfilled days must NOT teach pace ──"
# import_days writes rows dated in the past but stamped with NOW as logged_at.
D1=$(shift_day -1); D2=$(shift_day -2); D3=$(shift_day -3)
rpc import_days "{\"days\":[
  {\"date\":\"$D1\",\"meals\":[{\"description\":\"backfill\",\"kcal\":800,\"protein_g\":80,\"fat_g\":20,\"carb_g\":40,\"confidence\":\"low\"}]},
  {\"date\":\"$D2\",\"meals\":[{\"description\":\"backfill\",\"kcal\":800,\"protein_g\":80,\"fat_g\":20,\"carb_g\":40,\"confidence\":\"low\"}]},
  {\"date\":\"$D3\",\"meals\":[{\"description\":\"backfill\",\"kcal\":800,\"protein_g\":80,\"fat_g\":20,\"carb_g\":40,\"confidence\":\"low\"}]}
]}" >/dev/null
P2=$(rpc get_today '{}')
ck "3 imported days still teach nothing" 0 "$(printf '%s' "$P2" | jqn pace.days_compared)"
ck "still no typical" null "$(printf '%s' "$P2" | jqn pace.typical_protein_g)"

echo "── 3. same-day history does teach pace ──"
# `when` as a bare past date sets local_date; logged_at is stamped now, so these
# would ALSO be excluded. Write them directly to get a true same-day row.
# ONE d1 execute, not three. Concurrent `d1 execute --local` processes contend
# with the running `wrangler dev` for the SQLite file and fail SILENTLY —
# reporting success while writing nothing. Batch the statements instead.
NOWISO=$(node -e "console.log(new Date().toISOString())")
npx wrangler d1 execute macromiser --local --command "INSERT INTO meals (id,user_id,logged_at,local_date,meal_type,description,kcal,protein_g,fat_g,carb_g,alcohol_g,confidence,source,created_at) VALUES (lower(hex(randomblob(16))),'owner','${D1}T13:00:00.000Z','${D1}','lunch','same-day lunch',400,30,10,20,0,'medium','estimate','$NOWISO'); INSERT INTO meals (id,user_id,logged_at,local_date,meal_type,description,kcal,protein_g,fat_g,carb_g,alcohol_g,confidence,source,created_at) VALUES (lower(hex(randomblob(16))),'owner','${D2}T13:00:00.000Z','${D2}','lunch','same-day lunch',400,30,10,20,0,'medium','estimate','$NOWISO'); INSERT INTO meals (id,user_id,logged_at,local_date,meal_type,description,kcal,protein_g,fat_g,carb_g,alcohol_g,confidence,source,created_at) VALUES (lower(hex(randomblob(16))),'owner','${D3}T13:00:00.000Z','${D3}','lunch','same-day lunch',400,30,10,20,0,'medium','estimate','$NOWISO');" >/dev/null 2>&1
INSERTED=$(npx wrangler d1 execute macromiser --local --json --command "SELECT COUNT(*) AS n FROM meals WHERE description='same-day lunch'" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log((j[0]||j).results[0].n)}catch(e){console.log(0)}})")
ck "fixture rows actually landed" 3 "$INSERTED"
P3=$(rpc get_today '{}')
ck "3 same-day days now compared" 3 "$(printf '%s' "$P3" | jqn pace.days_compared)"
ck "typical protein computed" 30 "$(printf '%s' "$P3" | jqn pace.typical_protein_g)"
ck "today (20g) is behind" false "$(printf '%s' "$P3" | jqn pace.best_yet)"
ck "rank is last of four" 4 "$(printf '%s' "$P3" | jqn pace.rank)"

echo "── 4. beating them all reads as best yet ──"
rpc log_meal '{"description":"big lunch","kcal":700,"protein_g":70,"fat_g":25,"carb_g":45,"confidence":"medium"}' >/dev/null
P4=$(rpc get_today '{}')
ck "today is 90 g" 90 "$(printf '%s' "$P4" | jqn pace.protein_g)"
ck "best_yet" true "$(printf '%s' "$P4" | jqn pace.best_yet)"
ck "rank 1" 1 "$(printf '%s' "$P4" | jqn pace.rank)"
ck "briefing carries pace too" true "$(rpc get_briefing '{}' | jqn today.pace.best_yet)"

echo "── 5. the page renders it ──"
PAGE=$(curl -s "$B/app/$V")
ck "pace line rendered" 1 "$(printf '%s' "$PAGE" | grep -c 'class="pace lit"')"
ck "best-yet phrasing" 1 "$(printf '%s' "$PAGE" | grep -c 'your best pace yet')"
ck "pacing stub is gone" 0 "$(curl -s "$B/app/$E" | grep -c 'roadmap#pacing')"

echo "── 6. personal records ──"
R1=$(rpc log_workout "{\"when\":\"$D3\",\"sets\":[{\"exercise\":\"back squat\",\"set_no\":1,\"reps\":6,\"weight_lb\":205}]}")
ck "first load logged is NOT a PR" true "$(printf '%s' "$R1" | jqn personal_records.0.first_ever)"
R2=$(rpc log_workout "{\"when\":\"$D1\",\"sets\":[{\"exercise\":\"back squat\",\"set_no\":1,\"reps\":5,\"weight_lb\":225}]}")
ck "beating it IS a PR" 225 "$(printf '%s' "$R2" | jqn personal_records.0.weight_lb)"
ck "previous best reported" 205 "$(printf '%s' "$R2" | jqn personal_records.0.previous_best_lb)"
ck "not flagged first_ever" false "$(printf '%s' "$R2" | jqn personal_records.0.first_ever)"
R3=$(rpc log_workout "{\"sets\":[{\"exercise\":\"back squat\",\"set_no\":1,\"reps\":8,\"weight_lb\":185}]}")
ck "a lighter session is no PR" '[]' "$(printf '%s' "$R3" | jqn personal_records)"
R4=$(rpc log_workout "{\"sets\":[{\"exercise\":\"bench press\",\"set_no\":1,\"reps\":3,\"weight_lb\":999,\"completed\":false}]}")
ck "a MISSED attempt is not a PR" '[]' "$(printf '%s' "$R4" | jqn personal_records)"

echo "── 7. best_ever on get_last_performance ──"
LP=$(rpc get_last_performance '{"exercises":["squats"]}')
ck "best_ever found via an alias" 225 "$(printf '%s' "$LP" | jqn exercises.0.best_ever.weight_lb)"
ck "dated to when first hit" "$D1" "$(printf '%s' "$LP" | jqn exercises.0.best_ever.local_date)"
ck "is_today false" false "$(printf '%s' "$LP" | jqn exercises.0.best_ever.is_today)"
ck "no-history lift returns null" null "$(rpc get_last_performance '{"exercises":["zercher squat"]}' | jqn exercises.0.best_ever)"

echo "── 8. the share affordance (owner only) ──"
ck "offered on the editable page" 1 "$(curl -s "$B/app/$E" | grep -c 'Share a read-only view')"
ck "NOT on the read-only page" 0 "$(curl -s "$B/app/$V" | grep -c 'Share a read-only view')"
# The block itself, not the CSS rule — `.share-link{...}` ships in PAGE_CSS on
# every page, so grepping the bare class name matches the stylesheet.
ck "no share block on the read-only page" 0 "$(curl -s "$B/app/$V" | grep -c 'details class="share"')"
ck "the EDIT secret never appears on the view page" 0 "$(curl -s "$B/app/$V" | grep -c "$E")"

echo
echo "════ $PASS passed, $FAIL failed ════"
[ "$FAIL" -eq 0 ]
