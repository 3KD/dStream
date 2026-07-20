#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PRUNE_THRESHOLD_PCT="${DSTREAM_DISK_PRUNE_THRESHOLD_PCT:-80}"
FAIL_THRESHOLD_PCT="${DSTREAM_DISK_FAIL_PCT:-92}"
JOURNAL_MAX_SIZE="${DSTREAM_JOURNAL_MAX_SIZE:-256M}"

for value in "${PRUNE_THRESHOLD_PCT}" "${FAIL_THRESHOLD_PCT}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || (( value < 1 || value > 100 )); then
    echo "ERROR: disk thresholds must be integers from 1 through 100."
    exit 1
  fi
done

disk_usage_pct() {
  df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

usage_before="$(disk_usage_pct)"
echo "dStream disk cleanup"
echo "  usage before: ${usage_before}%"
echo "  prune threshold: ${PRUNE_THRESHOLD_PCT}%"

if (( usage_before < PRUNE_THRESHOLD_PCT )); then
  echo "PASS: cleanup not required."
  exit 0
fi

# These paths are deploy/build artifacts. Runtime state lives in named Docker
# volumes and /var/lib/dstream, none of which are touched here.
rm -rf \
  "${PROJECT_DIR}/node_modules" \
  "${PROJECT_DIR}/.next" \
  "${PROJECT_DIR}/.turbo" \
  "${PROJECT_DIR}/.playwright-cli" \
  "${PROJECT_DIR}/output/playwright" \
  "${PROJECT_DIR}/apps/web/.next" \
  "${PROJECT_DIR}/apps/desktop/dist" \
  "${PROJECT_DIR}/apps/desktop/node_modules"

if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-size="${JOURNAL_MAX_SIZE}" >/dev/null || true
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get clean || true
fi

if command -v docker >/dev/null 2>&1; then
  docker container prune -f >/dev/null || true
  docker image prune -f >/dev/null || true

  if ps -eo args= | grep -Eq '[d]ocker( compose)? .*build|[d]ocker-buildx (bake|build)'; then
    echo "  Docker build detected; preserving active build cache."
  else
    docker builder prune -af >/dev/null || true
  fi
fi

usage_after="$(disk_usage_pct)"
echo "  usage after: ${usage_after}%"

if (( usage_after >= FAIL_THRESHOLD_PCT )); then
  echo "ERROR: disk usage remains at or above ${FAIL_THRESHOLD_PCT}%."
  exit 1
fi

echo "PASS: disk cleanup complete."
