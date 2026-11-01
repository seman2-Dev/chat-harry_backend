#!/bin/bash
# End-to-end smoke test for the StudioSpace Express API.
#
# Prerequisites: mongod running (cat_harry_fontend: npm run db:start) and this
# server running (npm run dev). Uses mongosh to clean its own test accounts.
#
# Usage:
#   API=http://localhost:5000 MONGO_URI=mongodb://127.0.0.1:27017/studiospace \
#     bash scripts/smoke.sh
set -u

API=${API:-http://localhost:5000}
MONGO_URI=${MONGO_URI:-mongodb://127.0.0.1:27017/studiospace}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
J1="$TMP/jar1.txt"
J2="$TMP/jar2.txt"
LAST="$TMP/last.json"
PASS=0
FAIL=0

check() { # check <label> <expected_code> <actual_code>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); echo "PASS  $1 ($3)";
  else FAIL=$((FAIL + 1)); echo "FAIL  $1 expected=$2 got=$3"; fi
}

code() { curl -s -o "$LAST" -w "%{http_code}" "$@"; }

if ! curl -sf "$API/api/health" >/dev/null; then
  echo "API is not reachable at $API (start it with npm run dev)" >&2
  exit 1
fi

# Clean state from any previous run (test accounts only).
if command -v mongosh >/dev/null 2>&1; then
  mongosh "$MONGO_URI" --quiet --eval '
    const emails = ["api-one@studiospace.dev","api-two@studiospace.dev","api-weak@studiospace.dev"];
    db.bookings.deleteMany({ userEmail: { $in: emails } });
    db.studios.deleteMany({ ownerEmail: { $in: emails } });
    db.user.deleteMany({ email: { $in: emails } });
    db.account.deleteMany({ "user.email": { $in: emails } });
    db.session.deleteMany({ "user.email": { $in: emails } });
  ' >/dev/null 2>&1
fi

echo "--- public reads ---"
c=$(code "$API/api/studios"); check "GET /api/studios" 200 "$c"
c=$(code "$API/api/studios/featured"); check "GET /api/studios/featured" 200 "$c"

echo "--- Challenge 1: no session => 401 ---"
c=$(code -X POST "$API/api/studios" -H "Content-Type: application/json" -d '{}')
check "POST /api/studios unauthenticated" 401 "$c"
c=$(code -X DELETE "$API/api/studios/64b000000000000000000000")
check "DELETE /api/studios unauthenticated" 401 "$c"
c=$(code "$API/api/bookings"); check "GET /api/bookings unauthenticated" 401 "$c"
c=$(code -X POST "$API/api/bookings" -H "Content-Type: application/json" -d '{}')
check "POST /api/bookings unauthenticated" 401 "$c"

echo "--- BetterAuth sign-up / sign-in ---"
c=$(code -X POST "$API/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d '{"name":"Api Tester One","email":"api-one@studiospace.dev","password":"Str0ngPass","image":"https://example.com/a.png"}')
check "sign-up valid" 200 "$c"
c=$(code -X POST "$API/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d '{"name":"Weak","email":"api-weak@studiospace.dev","password":"abcde"}')
check "sign-up short password rejected" 400 "$c"
c=$(code -X POST "$API/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d '{"name":"Api Tester Two","email":"api-two@studiospace.dev","password":"Str0ngPass"}')
check "sign-up user two" 200 "$c"
c=$(code -X POST "$API/api/auth/sign-in/email" -H "Content-Type: application/json" \
  -d '{"email":"api-one@studiospace.dev","password":"WrongPass"}')
check "sign-in wrong password" 401 "$c"
c=$(code -c "$J1" -X POST "$API/api/auth/sign-in/email" -H "Content-Type: application/json" \
  -d '{"email":"api-one@studiospace.dev","password":"Str0ngPass"}')
check "sign-in user one" 200 "$c"
c=$(code -c "$J2" -X POST "$API/api/auth/sign-in/email" -H "Content-Type: application/json" \
  -d '{"email":"api-two@studiospace.dev","password":"Str0ngPass"}')
check "sign-in user two" 200 "$c"
grep -q "better-auth.session_token" "$J1" && { PASS=$((PASS + 1)); echo "PASS  HttpOnly session cookie issued"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  session cookie missing"; }

echo "--- studios CRUD + ownership ---"
c=$(code -b "$J1" -X POST "$API/api/studios" -H "Content-Type: application/json" -d '{}')
check "POST /api/studios invalid body" 400 "$c"
jq -e '.fields.title and .fields.hourlyRate and .fields.overview' "$LAST" >/dev/null &&
  { PASS=$((PASS + 1)); echo "PASS  validation fields payload"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  validation fields payload"; }

c=$(code -b "$J1" -X POST "$API/api/studios" -H "Content-Type: application/json" -d '{
  "title":"Curl Test Sound Stage","category":"Sound Stage","hourlyRate":95,
  "securityDeposit":200,"maxCapacity":20,"location":"Austin, TX",
  "imageUrl":"https://example.com/stage.jpg","amenities":["Wi-Fi","Parking"],
  "overview":"A test stage created by the API smoke test suite with enough overview text."}')
check "POST /api/studios valid" 201 "$c"
SID=$(jq -r '.studio._id // empty' "$LAST")
OWNER=$(jq -r '.studio.ownerEmail // empty' "$LAST")
[ -n "$SID" ] && [ "$OWNER" = "api-one@studiospace.dev" ] &&
  { PASS=$((PASS + 1)); echo "PASS  studio stored with session ownerEmail"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  studio ownerEmail sid=$SID owner=$OWNER"; }

c=$(code "$API/api/studios/$SID"); check "GET /api/studios/:id" 200 "$c"
c=$(code "$API/api/studios/not-an-id"); check "GET invalid id" 400 "$c"
c=$(code "$API/api/studios/64b000000000000000000000"); check "GET unknown id" 404 "$c"

c=$(code -b "$J1" -X PUT "$API/api/studios/$SID" -H "Content-Type: application/json" -d '{
  "title":"Curl Test Sound Stage v2","category":"Sound Stage","hourlyRate":110,
  "securityDeposit":200,"maxCapacity":20,"location":"Austin, TX",
  "imageUrl":"https://example.com/stage.jpg","amenities":["Wi-Fi"],
  "overview":"Updated by the smoke test with a longer overview string."}')
check "PUT own studio" 200 "$c"
[ "$(jq -r '.studio.hourlyRate' "$LAST")" = "110" ] &&
  { PASS=$((PASS + 1)); echo "PASS  PUT applied update"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  PUT applied update"; }

c=$(code -b "$J2" -X PUT "$API/api/studios/$SID" -H "Content-Type: application/json" -d '{
  "title":"Hijack","category":"Sound Stage","hourlyRate":1,"maxCapacity":1,
  "location":"X","imageUrl":"https://example.com/x.jpg",
  "overview":"Attempting to edit someone elses studio listing here."}')
check "PUT other user's studio" 403 "$c"
c=$(code -b "$J2" -X DELETE "$API/api/studios/$SID")
check "DELETE other user's studio" 403 "$c"

echo "--- bookings + Challenge 2 (double-booking) ---"
c=$(code -b "$J1" -X POST "$API/api/bookings" -H "Content-Type: application/json" -d '{}')
check "POST /api/bookings invalid body" 400 "$c"
c=$(code -b "$J1" -X POST "$API/api/bookings" -H "Content-Type: application/json" -d '{
  "studioId":"64b000000000000000000000","date":"2026-11-10","startTime":"10:00","durationHours":2}')
check "POST booking unknown studio" 404 "$c"
c=$(code -b "$J1" -X POST "$API/api/bookings" -H "Content-Type: application/json" -d "{
  \"studioId\":\"$SID\",\"date\":\"2026-11-10\",\"startTime\":\"10:00\",\"durationHours\":2,\"totalPrice\":220,\"note\":\"Smoke test booking\"}")
check "POST booking valid" 201 "$c"
BID=$(jq -r '.booking._id // empty' "$LAST")
[ -n "$BID" ] && [ "$(jq -r '.booking.status' "$LAST")" = "Pending" ] &&
  { PASS=$((PASS + 1)); echo "PASS  booking starts Pending"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  booking starts Pending"; }

c=$(code -b "$J1" -X POST "$API/api/bookings" -H "Content-Type: application/json" -d "{
  \"studioId\":\"$SID\",\"date\":\"2026-11-10\",\"startTime\":\"11:00\",\"durationHours\":2}")
check "overlapping booking rejected" 409 "$c"
c=$(code -b "$J1" -X POST "$API/api/bookings" -H "Content-Type: application/json" -d "{
  \"studioId\":\"$SID\",\"date\":\"2026-11-10\",\"startTime\":\"14:00\",\"durationHours\":3}")
check "non-overlapping booking accepted" 201 "$c"

c=$(code -b "$J1" "$API/api/bookings"); check "GET own bookings" 200 "$c"
N1=$(jq '.bookings | length' "$LAST")
[ "$N1" = "2" ] && { PASS=$((PASS + 1)); echo "PASS  only own bookings returned ($N1)"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  only own bookings returned got=$N1"; }
c=$(code -b "$J2" "$API/api/bookings"); check "GET bookings user two" 200 "$c"
N2=$(jq '.bookings | length' "$LAST")
[ "$N2" = "0" ] && { PASS=$((PASS + 1)); echo "PASS  bookings scoped to user ($N2)"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  bookings scoped to user got=$N2"; }

c=$(code -b "$J2" -X PATCH "$API/api/bookings/$BID" -H "Content-Type: application/json" -d '{"status":"Cancelled"}')
check "PATCH other user's booking" 403 "$c"
c=$(code -b "$J1" -X PATCH "$API/api/bookings/$BID" -H "Content-Type: application/json" -d '{"status":"Confirmed"}')
check "guest cannot confirm own booking" 403 "$c"
c=$(code -b "$J1" -X PATCH "$API/api/bookings/$BID" -H "Content-Type: application/json" -d '{"status":"Cancelled"}')
check "PATCH cancel own pending booking" 200 "$c"
c=$(code -b "$J1" -X PATCH "$API/api/bookings/$BID" -H "Content-Type: application/json" -d '{"status":"Cancelled"}')
check "PATCH cancel again" 409 "$c"

echo "--- list filters + featured limit ---"
c=$(code "$API/api/studios?category=Sound%20Stage"); check "GET filter by category" 200 "$c"
jq -e '.studios | length >= 1' "$LAST" >/dev/null &&
  { PASS=$((PASS + 1)); echo "PASS  category filter returns rows"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  category filter returns rows"; }
c=$(code "$API/api/studios?q=curl"); check "GET search q" 200 "$c"
c=$(code "$API/api/studios?sort=bogus&limit=abc"); check "GET bogus query params safe" 200 "$c"
c=$(code "$API/api/studios/featured")
jq -e '.studios | length <= 6' "$LAST" >/dev/null &&
  { PASS=$((PASS + 1)); echo "PASS  featured limit <= 6"; } ||
  { FAIL=$((FAIL + 1)); echo "FAIL  featured limit <= 6"; }

echo "--- cleanup ---"
c=$(code -b "$J1" -X DELETE "$API/api/studios/$SID"); check "DELETE own studio" 200 "$c"
c=$(code "$API/api/studios/$SID"); check "GET deleted studio" 404 "$c"

echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
