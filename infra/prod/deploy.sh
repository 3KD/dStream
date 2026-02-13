#!/usr/bin/env bash
# dStream (current stack) push-to-deploy script.
# Deploys the modern root docker-compose stack from `.dstream-work`.
#
# Usage:
#   ./deploy.sh user@host
#
# Optional env vars:
#   DSTREAM_DEPLOY_PROJECT_DIR=/abs/path/to/project   (default: ../../.dstream-work)
#   DSTREAM_DEPLOY_REMOTE_DIR=/opt/dstream            (remote project path)
#   DSTREAM_DEPLOY_REAL_WALLET=1                      (include docker-compose.real-wallet.yml)
#   DSTREAM_DEPLOY_NETWORK=dstream_default            (docker network for app + caddy)
#   DSTREAM_DEPLOY_CADDY_CONTAINER=dStream_caddy      (edge proxy container name)
#   DSTREAM_DEPLOY_DOMAIN=dstream.stream              (public domain for HTTPS checks)
#   DSTREAM_DEPLOY_SELF_HEAL=1                        (recreate edge proxy container)
#   DSTREAM_DEPLOY_HEALTHCHECK=1                      (run post-deploy route probes)

set -euo pipefail

TARGET="${1:-}"
if [[ -z "${TARGET}" ]]; then
  echo "Usage: ./deploy.sh user@host"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROJECT_DIR="$(cd "${SCRIPT_DIR}/../../.dstream-work" && pwd)"
PROJECT_DIR="${DSTREAM_DEPLOY_PROJECT_DIR:-${DEFAULT_PROJECT_DIR}}"
REMOTE_DIR="${DSTREAM_DEPLOY_REMOTE_DIR:-/opt/dstream}"
DEPLOY_NETWORK="${DSTREAM_DEPLOY_NETWORK:-dstream_default}"
DEPLOY_CADDY_CONTAINER="${DSTREAM_DEPLOY_CADDY_CONTAINER:-dStream_caddy}"
DEPLOY_DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-dstream.stream}"
DEPLOY_SELF_HEAL="${DSTREAM_DEPLOY_SELF_HEAL:-1}"
DEPLOY_HEALTHCHECK="${DSTREAM_DEPLOY_HEALTHCHECK:-1}"
SSH_CONTROL_PATH="${DSTREAM_DEPLOY_SSH_CONTROL_PATH:-/tmp/dstream-%C}"
SSH_MULTIPLEX="${DSTREAM_DEPLOY_SSH_MULTIPLEX:-1}"
if [[ "${SSH_MULTIPLEX}" == "1" ]]; then
  SSH_OPTS=(
    -o ControlMaster=auto
    -o ControlPersist=5m
    -o "ControlPath=${SSH_CONTROL_PATH}"
  )
  RSYNC_SSH_CMD="ssh ${SSH_OPTS[*]}"
else
  SSH_OPTS=()
  RSYNC_SSH_CMD="ssh"
fi

run_ssh() {
  if [[ "${SSH_MULTIPLEX}" == "1" ]]; then
    ssh "${SSH_OPTS[@]}" "$@"
  else
    ssh "$@"
  fi
}

if [[ ! -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
  echo "ERROR: ${PROJECT_DIR}/docker-compose.yml not found."
  echo "Set DSTREAM_DEPLOY_PROJECT_DIR to the current dStream project root."
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/.env.production" ]]; then
  echo "ERROR: ${PROJECT_DIR}/.env.production not found."
  if [[ -f "${PROJECT_DIR}/.env.production.example" ]]; then
    echo "Copy .env.production.example -> .env.production and fill real values first."
  fi
  exit 1
fi

if [[ "${DSTREAM_DEPLOY_SKIP_PREFLIGHT:-0}" != "1" ]]; then
  if [[ ! -f "${PROJECT_DIR}/scripts/harden-check.mjs" ]]; then
    echo "ERROR: ${PROJECT_DIR}/scripts/harden-check.mjs not found."
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is required for preflight checks."
    exit 1
  fi
  echo "🔹 Running deploy preflight (harden:deploy)..."
  (
    cd "${PROJECT_DIR}"
    HARDEN_MODE=deploy ENV_FILE="${PROJECT_DIR}/.env.production" node scripts/harden-check.mjs
  )
fi

echo "🚀 Deploying dStream current stack"
echo "   local:  ${PROJECT_DIR}"
echo "   remote: ${TARGET}:${REMOTE_DIR}"

echo "🔹 Ensuring remote directory exists..."
run_ssh "${TARGET}" "mkdir -p '${REMOTE_DIR}'"

echo "🔹 Syncing files..."
rsync -az --delete \
  -e "${RSYNC_SSH_CMD}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.turbo' \
  --exclude '*.log' \
  "${PROJECT_DIR}/" "${TARGET}:${REMOTE_DIR}/"

COMPOSE_ARGS="-f docker-compose.yml"
if [[ "${DSTREAM_DEPLOY_REAL_WALLET:-0}" == "1" ]]; then
  COMPOSE_ARGS="${COMPOSE_ARGS} -f docker-compose.real-wallet.yml"
fi

echo "🔹 Rebuilding and restarting containers..."
run_ssh "${TARGET}" "cd '${REMOTE_DIR}' && \
  docker compose ${COMPOSE_ARGS} --env-file .env.production down --remove-orphans || true && \
  docker compose ${COMPOSE_ARGS} --env-file .env.production up -d --build --remove-orphans"

if [[ "${DEPLOY_SELF_HEAL}" == "1" ]]; then
  echo "🔹 Self-healing edge proxy (${DEPLOY_CADDY_CONTAINER})..."
  run_ssh "${TARGET}" "bash -s -- '${REMOTE_DIR}' '${DEPLOY_NETWORK}' '${DEPLOY_CADDY_CONTAINER}' '${DEPLOY_DOMAIN}'" <<'EOS'
set -euo pipefail

remote_dir="$1"
network_name="$2"
caddy_container="$3"
domain="$4"

mkdir -p "${remote_dir}/infra/prod" "${remote_dir}/.caddy-data" "${remote_dir}/.caddy-config"

if [[ ! -s "${remote_dir}/infra/prod/Caddyfile" ]]; then
  printf '%s\n' "${domain}, www.${domain} {" "  reverse_proxy dstream-web-1:5656" "}" > "${remote_dir}/infra/prod/Caddyfile"
fi

if ! docker network inspect "${network_name}" >/dev/null 2>&1; then
  echo "ERROR: docker network ${network_name} not found."
  docker network ls --format '  - {{.Name}}'
  exit 1
fi

docker rm -f "${caddy_container}" >/dev/null 2>&1 || true

docker run -d \
  --name "${caddy_container}" \
  --restart unless-stopped \
  --network "${network_name}" \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  -v "${remote_dir}/infra/prod/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "${remote_dir}/.caddy-data:/data" \
  -v "${remote_dir}/.caddy-config:/config" \
  caddy:2.7-alpine >/dev/null

sleep 2
if ! docker ps --format '{{.Names}}' | grep -qx "${caddy_container}"; then
  echo "ERROR: ${caddy_container} failed to start."
  docker logs --tail 160 "${caddy_container}" || true
  exit 1
fi
EOS
fi

if [[ "${DEPLOY_HEALTHCHECK}" == "1" ]]; then
  echo "🔹 Running post-deploy health checks..."
  run_ssh "${TARGET}" "bash -s -- '${DEPLOY_DOMAIN}' '${DEPLOY_CADDY_CONTAINER}'" <<'EOS'
set -euo pipefail

domain="$1"
caddy_container="$2"

check_http_with_retry() {
  local url="$1"
  local expected="$2"
  local timeout_sec="${3:-45}"
  local started_at now elapsed code
  started_at="$(date +%s)"
  while true; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "${expected}" ]]; then
      return 0
    fi
    now="$(date +%s)"
    elapsed=$((now - started_at))
    if (( elapsed >= timeout_sec )); then
      echo "ERROR: expected ${expected} from ${url}, got ${code} after ${elapsed}s"
      return 1
    fi
    sleep 2
  done
}

check_https_resolved_with_retry() {
  local path="$1"
  local expected="$2"
  local timeout_sec="${3:-240}"
  local started_at now elapsed code
  started_at="$(date +%s)"
  while true; do
    code="$(curl -k -s -o /dev/null -w '%{http_code}' --resolve "${domain}:443:127.0.0.1" "https://${domain}${path}" || true)"
    if [[ "${code}" == "${expected}" ]]; then
      return 0
    fi
    now="$(date +%s)"
    elapsed=$((now - started_at))
    if (( elapsed >= timeout_sec )); then
      echo "ERROR: expected ${expected} from https://${domain}${path}, got ${code} after ${elapsed}s"
      echo "--- docker ps ---"
      docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
      echo "--- ${caddy_container} logs (last 5m) ---"
      docker logs --since 5m "${caddy_container}" 2>&1 | tail -n 180 || true
      return 1
    fi
    sleep 3
  done
}

check_http_with_retry "http://127.0.0.1:5656/settings" "200" "60"

if [[ -n "${domain}" ]]; then
  check_https_resolved_with_retry "/" "200" "240"
  check_https_resolved_with_retry "/browse" "200" "120"
  check_https_resolved_with_retry "/broadcast" "200" "120"
  check_https_resolved_with_retry "/settings" "200" "120"
fi

echo "health checks: PASS"
EOS
fi

if [[ "${SSH_MULTIPLEX}" == "1" ]]; then
  run_ssh -O exit "${TARGET}" >/dev/null 2>&1 || true
fi

echo "✅ Deployment complete."
echo "Next checks:"
echo "  ssh ${TARGET} 'cd ${REMOTE_DIR} && docker compose ${COMPOSE_ARGS} --env-file .env.production ps'"
echo "  ssh ${TARGET} 'cd ${REMOTE_DIR} && docker compose ${COMPOSE_ARGS} --env-file .env.production logs --since 5m web'"
