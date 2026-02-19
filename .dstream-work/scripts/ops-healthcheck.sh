#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET="${1:-${SSH_TARGET:-}}"
if [[ -n "${TARGET}" ]]; then
  REMOTE_DIR="${DSTREAM_REMOTE_DIR:-/opt/dstream}"
else
  REMOTE_DIR="${DSTREAM_REMOTE_DIR:-${PROJECT_DIR}}"
fi
DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-dstream.stream}"
WEBHOOK_URL="${DSTREAM_ALERT_WEBHOOK_URL:-${ALERT_WEBHOOK_URL:-}}"

declare -a FAILURES=()

log() {
  printf '%s\n' "$*"
}

record_failure() {
  FAILURES+=("$1")
  log "FAIL: $1"
}

run_cmd() {
  local cmd="$1"
  if [[ -n "${TARGET}" ]]; then
    ssh "${TARGET}" "${cmd}"
  else
    bash -lc "${cmd}"
  fi
}

check_service_presence() {
  local ps_output="$1"
  if ! grep -qiE 'dstream-web-1|web' <<<"${ps_output}"; then
    record_failure "compose ps missing web service"
  fi
  if ! grep -qiE 'dstream-mediamtx-1|mediamtx' <<<"${ps_output}"; then
    record_failure "compose ps missing mediamtx service"
  fi
  if ! grep -qiE 'dstream-relay-1|relay' <<<"${ps_output}"; then
    record_failure "compose ps missing relay service"
  fi
}

send_alert_if_needed() {
  if [[ ${#FAILURES[@]} -eq 0 ]]; then
    return
  fi
  if [[ -z "${WEBHOOK_URL}" ]]; then
    return
  fi

  local message
  message="$(printf '%s; ' "${FAILURES[@]}")"
  message="${message%; }"
  local escaped
  escaped="$(printf '%s' "${message}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  local host_name
  host_name="$(hostname -f 2>/dev/null || hostname)"
  local payload
  payload="$(printf '{"source":"dstream-healthcheck","status":"fail","host":"%s","domain":"%s","target":"%s","message":"%s"}' "${host_name}" "${DOMAIN}" "${TARGET:-local}" "${escaped}")"
  if ! curl -fsS -X POST -H 'Content-Type: application/json' -d "${payload}" "${WEBHOOK_URL}" >/dev/null; then
    log "WARN: failed to send alert webhook"
  fi
}

echo "dStream ops healthcheck"
echo "  target: ${TARGET:-local}"
echo "  project: ${REMOTE_DIR}"
echo "  domain: ${DOMAIN}"
echo

ps_output="$(run_cmd "cd '${REMOTE_DIR}' && docker compose -f docker-compose.yml --env-file .env.production ps" 2>/dev/null || true)"
if [[ -z "${ps_output}" ]]; then
  record_failure "unable to read docker compose status"
else
  check_service_presence "${ps_output}"
fi

settings_code="$(run_cmd "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5656/settings" 2>/dev/null || true)"
if [[ "${settings_code}" != "200" ]]; then
  record_failure "internal /settings health expected 200, got ${settings_code:-000}"
fi

mediamtx_code="$(run_cmd "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9990/v3/paths/list" 2>/dev/null || true)"
if [[ "${mediamtx_code}" != "200" ]]; then
  record_failure "mediamtx API expected 200, got ${mediamtx_code:-000}"
fi

relay_code="$(run_cmd "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/" 2>/dev/null || true)"
if [[ ! "${relay_code}" =~ ^(200|400|404|405|426)$ ]]; then
  record_failure "relay endpoint expected one of 200/400/404/405/426, got ${relay_code:-000}"
fi

for path in / /browse /broadcast /settings /analytics; do
  code="$(curl -k -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}${path}" 2>/dev/null || true)"
  if [[ "${code}" != "200" ]]; then
    record_failure "public ${path} expected 200, got ${code:-000}"
  fi
done

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  send_alert_if_needed
  echo
  echo "Healthcheck failed (${#FAILURES[@]} issue(s))."
  exit 1
fi

echo "PASS: ops healthcheck"
