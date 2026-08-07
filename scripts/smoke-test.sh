#!/usr/bin/env bash
# Smoke test for HR Insight AI — verifies all three services are alive,
# auth works, ML predictions work, and reports can be listed.
#
# Prerequisites:
#   - backend (3010), frontend (3001), ai-service (8000) running
#   - DB seeded (admin@hrinsight.com / Password123!)
#
# Usage: bash scripts/smoke-test.sh

set -e

BACKEND="${BACKEND:-http://localhost:3010}"
AI_SERVICE="${AI_SERVICE:-http://localhost:8000}"
FRONTEND="${FRONTEND:-http://localhost:3001}"

PASS="\033[32m✓\033[0m"
FAIL="\033[31m✗\033[0m"
fails=0

check() {
  local name="$1"
  local cond="$2"
  local detail="$3"
  if [ "$cond" = "true" ]; then
    echo -e "  $PASS $name"
  else
    echo -e "  $FAIL $name ${detail:+— $detail}"
    fails=$((fails + 1))
  fi
}

echo "=== HR Insight AI Smoke Test ==="
echo

echo "1. Service liveness"
ai_status=$(curl -s -o /dev/null -w "%{http_code}" "$AI_SERVICE/health")
be_status=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND/auth/profile")
fe_status=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND/login")

check "ai-service /health → 200" "$([ "$ai_status" = "200" ] && echo true || echo false)" "got $ai_status"
check "backend /auth/profile → 401 (auth required)" "$([ "$be_status" = "401" ] && echo true || echo false)" "got $be_status"
check "frontend /login → 200" "$([ "$fe_status" = "200" ] && echo true || echo false)" "got $fe_status"

echo
echo "2. ML model loaded"
model_loaded=$(curl -s "$AI_SERVICE/health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('model_loaded', False))")
check "model_loaded == true" "$([ "$model_loaded" = "True" ] && echo true || echo false)" "got $model_loaded"

echo
echo "3. Auth flow"
TOKEN=$(curl -s -X POST "$BACKEND/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrinsight.com","password":"Password123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
check "login returns access_token" "$([ -n "$TOKEN" ] && echo true || echo false)"

profile=$(curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND/auth/profile" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('role',''))")
check "GET /auth/profile returns role=ADMIN" "$([ "$profile" = "ADMIN" ] && echo true || echo false)" "got $profile"

echo
echo "4. Data access"
team_count=$(curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND/teams" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)")
check "GET /teams returns 3 teams" "$([ "$team_count" = "3" ] && echo true || echo false)" "got $team_count"

emp_count=$(curl -s -H "Authorization: Bearer $TOKEN" "$BACKEND/employees" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)")
check "GET /employees returns 60 employees" "$([ "$emp_count" = "60" ] && echo true || echo false)" "got $emp_count"

echo
echo "5. AI prediction"
pred=$(curl -s -X POST "$AI_SERVICE/predict/single" \
  -H "Content-Type: application/json" \
  -d '{"salary":35000,"tenureMonths":60,"engagementScore":1.5,"performanceScore":2.0,"absenteeismDays":15,"overtimeHours":45,"lastPromotionMonths":48,"trainingHours":5}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('risk_score',0)}|{d.get('risk_level','')}\")")
risk_score=$(echo "$pred" | cut -d'|' -f1)
risk_level=$(echo "$pred" | cut -d'|' -f2)
check "high-risk profile → risk_level in {MEDIUM,HIGH}" "$([ "$risk_level" = "HIGH" ] || [ "$risk_level" = "MEDIUM" ] && echo true || echo false)" "score=$risk_score level=$risk_level"

echo
echo "6. Reports + risk-snapshots endpoints"
reports_code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BACKEND/reports")
check "GET /reports → 200" "$([ "$reports_code" = "200" ] && echo true || echo false)" "got $reports_code"

snap_code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BACKEND/risk-snapshots/employee/nonexistent")
check "GET /risk-snapshots/employee/:id → 200" "$([ "$snap_code" = "200" ] && echo true || echo false)" "got $snap_code"

echo
echo "7. RBAC scoping"
TM_TOKEN=$(curl -s -X POST "$BACKEND/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"team.manager@hrinsight.com","password":"Password123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
tm_teams=$(curl -s -H "Authorization: Bearer $TM_TOKEN" "$BACKEND/teams" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)")
check "TEAM_MANAGER sees only 1 team (RBAC)" "$([ "$tm_teams" = "1" ] && echo true || echo false)" "got $tm_teams"

tm_emps=$(curl -s -H "Authorization: Bearer $TM_TOKEN" "$BACKEND/employees" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)")
check "TEAM_MANAGER sees only 20 employees (RBAC)" "$([ "$tm_emps" = "20" ] && echo true || echo false)" "got $tm_emps"

echo
echo "========================"
if [ "$fails" -eq 0 ]; then
  echo -e "$PASS all smoke checks passed"
  exit 0
else
  echo -e "$FAIL $fails check(s) failed"
  exit 1
fi
