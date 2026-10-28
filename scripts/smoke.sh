#!/usr/bin/env bash
# End-to-end smoke test against a running server.
# Usage: scripts/smoke.sh [base-url] [username]
set -u
B=${1:-http://127.0.0.1:8080}
U=${2:-smoke_$RANDOM}
J='Content-Type: application/json'
C=$(mktemp)
trap 'rm -f "$C"' EXIT

show() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

echo "== health";   curl -s "$B/api/health"; echo
echo "== register"; curl -s -c "$C" -H "$J" -d "{\"username\":\"$U\",\"password\":\"secret123\"}" "$B/api/auth/register" | head -c 300; echo
echo "== profile"
curl -s -b "$C" "$B/api/me" | show "print(d['player']); print('techniques', [(t['id'], t['owned'], t['slot'], t['locked']) for t in d['techniques']]); print('missions', [(m['id'], m['unlocked'], m.get('lockReason')) for m in d['missions']])"
echo "== buy fireball before earning ryo (should fail)"; curl -s -b "$C" -H "$J" -d '{"technique":"fireball"}' "$B/api/shop/buy"; echo
echo "== buy phoenix (locked)";          curl -s -b "$C" -H "$J" -d '{"technique":"phoenix"}' "$B/api/shop/buy"; echo
echo "== start varga (locked)";          curl -s -b "$C" -H "$J" -d '{"mission":"varga"}' "$B/api/battles"; echo
echo "== fight the bandit"
BID=$(curl -s -b "$C" -H "$J" -d '{"mission":"bandit"}' "$B/api/battles" | show "print(d['battle']['id'])")
for _ in $(seq 1 40); do
  R=$(curl -s -b "$C" -H "$J" -d '{"move":"fireball"}' "$B/api/battles/$BID/turn")
  echo "$R" | grep -q '"error"' && R=$(curl -s -b "$C" -H "$J" -d '{"move":"strike"}' "$B/api/battles/$BID/turn")
  echo "$R" | show "s=d['battle']['state']; print(' turn', s['turn'], s['phase'], 'P', s['p']['hp'], 'E', s['e']['hp'], [e['kind']+':'+e.get('move','') for e in d['events']], d.get('reward',''))"
  echo "$R" | grep -q '"phase":"over"' && break
done
echo "== buy fireball with mission ryo"; curl -s -b "$C" -H "$J" -d '{"technique":"fireball"}' "$B/api/shop/buy"; echo
echo "== move after battle ended (404)"; curl -s -b "$C" -H "$J" -d '{"move":"strike"}' "$B/api/battles/$BID/turn"; echo
echo "== leaderboard";                   curl -s -b "$C" "$B/api/leaderboard"; echo
echo "== non-JSON post (415)";           curl -s -b "$C" -H "Content-Type: text/plain" -d '{}' "$B/api/shop/buy"; echo
echo "== upgrade strike";                curl -s -b "$C" -X POST -H "$J" -d '{}' "$B/api/techniques/strike/upgrade"; echo
echo "== loadout ok";                    curl -s -b "$C" -X PUT -H "$J" -d '{"slots":["strike","fireball","guard"]}' "$B/api/loadout"; echo
echo "== loadout duplicate";             curl -s -b "$C" -X PUT -H "$J" -d '{"slots":["strike","strike"]}' "$B/api/loadout"; echo
echo "== loadout not owned";             curl -s -b "$C" -X PUT -H "$J" -d '{"slots":["phoenix"]}' "$B/api/loadout"; echo
echo "== logout";                        curl -s -c "$C" -b "$C" -H "$J" -d '{}' "$B/api/auth/logout"; echo
echo "== me after logout (401)";         curl -s -b "$C" "$B/api/me"; echo
echo "== wrong password (401)";          curl -s -H "$J" -d "{\"username\":\"$U\",\"password\":\"wrongpass1\"}" "$B/api/auth/login"; echo
