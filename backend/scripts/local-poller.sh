#!/bin/bash
# Run on your Mac: CRICAPI_KEY=xxx TOKEN=xxx bash local-poller.sh

BACKEND="https://fantasy-cricket-production.up.railway.app"
MATCH_ID="c26cb45e-361e-4613-8d7b-226e8255d67c"
DB_MATCH_ID=1
INTERVAL=60

echo "Local poller started — $(date)"

while true; do
  echo "--- $(date '+%H:%M:%S') ---"

  # Fetch from CricAPI on your Mac
  SCORECARD=$(curl -s "https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${MATCH_ID}")
  STATUS=$(echo "$SCORECARD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

  if [ "$STATUS" != "success" ]; then
    echo "  CricAPI: $STATUS"
    sleep $INTERVAL
    continue
  fi

  # Push raw scorecard to backend for processing
  RESULT=$(curl -s -X POST "${BACKEND}/api/admin/matches/${DB_MATCH_ID}/sync-scorecard" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$SCORECARD")

  echo "  Backend: $RESULT"
  sleep $INTERVAL
done
