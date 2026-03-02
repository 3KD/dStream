#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5656}"
NO_HLS_OVERRIDE="${DSTREAM_SMOKE_NO_HLS_OVERRIDE:-0}"
EXTRA_QS=""
if [ "$NO_HLS_OVERRIDE" = "1" ]; then
  EXTRA_QS="&noHlsOverride=1"
fi
PAGE_URL="${PAGE_URL:-$BASE_URL/dev/e2e?forceLocal=1&videoOnly=1${EXTRA_QS}}"
LOG_URL="${LOG_URL:-$BASE_URL/api/dev/log}"
TIMEOUT_SECS="${TIMEOUT_SECS:-120}"
BROWSER_APP="${DSTREAM_SMOKE_BROWSER_APP:-Google Chrome}"

echo "dStream smoke VIDEO"
echo "  page: $PAGE_URL"
echo "  log:  $LOG_URL"
echo "  timeout: ${TIMEOUT_SECS}s"
echo

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  docker compose up -d --no-deps --force-recreate relay >/dev/null 2>&1 || true
fi

curl -sS -X DELETE "$LOG_URL" >/dev/null || true

if command -v open >/dev/null 2>&1; then
  open -a "$BROWSER_APP" "$PAGE_URL" >/dev/null 2>&1 || open "$PAGE_URL" >/dev/null 2>&1 || true
fi

start_ts="$(date +%s)"

while true; do
  log="$(curl -sS "$LOG_URL" || true)"

  if echo "$log" | grep -q "FATAL:"; then
    echo "$log" | tail -n 120
    echo
    echo "FAIL (see FATAL above)"
    exit 1
  fi

  if echo "$log" | grep -q "WHIP publish: ok" \
    && echo "$log" | grep -q "HLS check: 200" \
    && echo "$log" | grep -q "Watch player: ok"; then
    echo "$log" | tail -n 120
    echo
    echo "PASS"
    exit 0
  fi

  now_ts="$(date +%s)"
  if (( now_ts - start_ts > TIMEOUT_SECS )); then
    echo "$log" | tail -n 120
    echo
    echo "TIMEOUT (did not observe video success markers)"
    exit 1
  fi

  sleep 1
done
