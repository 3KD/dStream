#!/usr/bin/env bash
# dStream (current stack) push-to-deploy script.
# Deploys the selected dStream project root.
# When multiple local dStream checkouts exist, DSTREAM_DEPLOY_PROJECT_DIR must be
# set explicitly so the script does not deploy the wrong workspace.
#
# Usage:
#   DSTREAM_DEPLOY_PROJECT_DIR=/abs/path/to/project ./deploy.sh user@host
#
# Optional env vars:
#   DSTREAM_DEPLOY_PROJECT_DIR=/abs/path/to/project   (required when multiple local dStream roots exist)
#   DSTREAM_DEPLOY_REMOTE_DIR=/opt/dstream            (remote project path)
#   DSTREAM_DEPLOY_REAL_WALLET=1                      (include docker-compose.real-wallet.yml)
#   DSTREAM_DEPLOY_NETWORK=dstream_default            (docker network for app + caddy)
#   DSTREAM_DEPLOY_CADDY_CONTAINER=dStream_caddy      (edge proxy container name)
#   DSTREAM_DEPLOY_DOMAIN=dstream.stream              (public domain for HTTPS checks)
#   DSTREAM_DEPLOY_SELF_HEAL=1                        (recreate edge proxy container)
#   DSTREAM_DEPLOY_HEALTHCHECK=1                      (run post-deploy route probes)
#   DSTREAM_DEPLOY_SMOKE=1                            (run post-deploy production smoke)
#   DSTREAM_DEPLOY_DISK_CLEANUP=1                     (run remote disk cleanup before build)
#   DSTREAM_DEPLOY_MIN_FREE_GB=auto                   (minimum free GB required before build)
#   DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES=auto          (local prebuilt app images: auto|none|all|csv of web,manifest,transcoder)
#   DSTREAM_DEPLOY_LOCAL_BUILD_PLATFORM=linux/amd64   (platform for local app image builds)
#   DSTREAM_DEPLOY_LOCAL_WEB_BUILD=0                  (legacy alias for DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES=web)
#   DSTREAM_DEPLOY_DRY_RUN=1                          (validate local config and print selected source)

set -euo pipefail

TARGET="${1:-}"
if [[ -z "${TARGET}" ]]; then
  echo "Usage: ./deploy.sh user@host"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_dir() {
  local path="$1"
  if [[ -d "${path}" ]]; then
    (
      cd "${path}"
      pwd
    )
  fi
}

WORKSPACE_PROJECT_DIR="$(resolve_dir "${SCRIPT_DIR}/../../.dstream-work" || true)"
LEGACY_PROJECT_DIR="$(resolve_dir "${SCRIPT_DIR}/../../../dStream" || true)"
PROJECT_DIR="${DSTREAM_DEPLOY_PROJECT_DIR:-}"
PROJECT_DIR_SOURCE="DSTREAM_DEPLOY_PROJECT_DIR"
if [[ -n "${PROJECT_DIR}" ]]; then
  if [[ ! -d "${PROJECT_DIR}" ]]; then
    echo "ERROR: DSTREAM_DEPLOY_PROJECT_DIR does not exist: ${PROJECT_DIR}"
    exit 1
  fi
  PROJECT_DIR="$(cd "${PROJECT_DIR}" && pwd)"
else
  PROJECT_DIR_SOURCE="auto-detect"
  CANDIDATE_DIRS=()
  if [[ -n "${WORKSPACE_PROJECT_DIR}" ]]; then
    CANDIDATE_DIRS+=("${WORKSPACE_PROJECT_DIR}")
  fi
  if [[ -n "${LEGACY_PROJECT_DIR}" && "${LEGACY_PROJECT_DIR}" != "${WORKSPACE_PROJECT_DIR}" ]]; then
    CANDIDATE_DIRS+=("${LEGACY_PROJECT_DIR}")
  fi

  if (( ${#CANDIDATE_DIRS[@]} == 0 )); then
    echo "ERROR: could not find a local dStream project root."
    echo "Set DSTREAM_DEPLOY_PROJECT_DIR to the current dStream project root."
    exit 1
  fi

  if (( ${#CANDIDATE_DIRS[@]} > 1 )); then
    echo "ERROR: multiple local dStream project roots detected."
    echo "Set DSTREAM_DEPLOY_PROJECT_DIR explicitly to the one you want to deploy:"
    for candidate in "${CANDIDATE_DIRS[@]}"; do
      echo "  - ${candidate}"
    done
    exit 1
  fi

  PROJECT_DIR="${CANDIDATE_DIRS[0]}"
fi

REMOTE_DIR="${DSTREAM_DEPLOY_REMOTE_DIR:-/opt/dstream}"
DEPLOY_NETWORK="${DSTREAM_DEPLOY_NETWORK:-dstream_default}"
DEPLOY_CADDY_CONTAINER="${DSTREAM_DEPLOY_CADDY_CONTAINER:-dStream_caddy}"
DEPLOY_DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-dstream.stream}"
DEPLOY_SELF_HEAL="${DSTREAM_DEPLOY_SELF_HEAL:-1}"
DEPLOY_HEALTHCHECK="${DSTREAM_DEPLOY_HEALTHCHECK:-1}"
DEPLOY_SMOKE="${DSTREAM_DEPLOY_SMOKE:-1}"
DEPLOY_DISK_CLEANUP="${DSTREAM_DEPLOY_DISK_CLEANUP:-1}"
DEPLOY_MIN_FREE_GB_RAW="${DSTREAM_DEPLOY_MIN_FREE_GB:-auto}"
DEPLOY_LOCAL_BUILD_PLATFORM="${DSTREAM_DEPLOY_LOCAL_BUILD_PLATFORM:-linux/amd64}"
if [[ -n "${DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES:-}" ]]; then
  DEPLOY_LOCAL_BUILD_SERVICES_RAW="${DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES}"
elif [[ -n "${DSTREAM_DEPLOY_LOCAL_WEB_BUILD+x}" ]]; then
  if [[ "${DSTREAM_DEPLOY_LOCAL_WEB_BUILD}" == "1" ]]; then
    DEPLOY_LOCAL_BUILD_SERVICES_RAW="web"
  else
    DEPLOY_LOCAL_BUILD_SERVICES_RAW="none"
  fi
else
  DEPLOY_LOCAL_BUILD_SERVICES_RAW="auto"
fi
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

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

service_image_name() {
  case "$1" in
    web) printf '%s' "dstream-web:latest" ;;
    manifest) printf '%s' "dstream-manifest:latest" ;;
    transcoder) printf '%s' "dstream-transcoder:latest" ;;
    *)
      echo "ERROR: unsupported service for image export: $1" >&2
      exit 1
      ;;
  esac
}

parse_local_build_services() {
  local raw="$1"
  local token normalized
  local requested=()

  if [[ "${raw}" == "auto" ]]; then
    if docker_ready; then
      LOCAL_BUILD_SERVICES=(web manifest transcoder)
    else
      echo "🔹 Local Docker unavailable; falling back to remote app builds."
      LOCAL_BUILD_SERVICES=()
    fi
    return
  fi

  if [[ -z "${raw}" || "${raw}" == "none" ]]; then
    LOCAL_BUILD_SERVICES=()
    return
  fi

  if ! docker_ready; then
    echo "ERROR: docker is required for local app image builds."
    exit 1
  fi

  IFS=',' read -r -a requested <<< "${raw}"
  LOCAL_BUILD_SERVICES=()
  for token in "${requested[@]}"; do
    token="$(trim "${token}")"
    case "${token}" in
      ""|none)
        ;;
      all)
        normalized=(web manifest transcoder)
        for token in "${normalized[@]}"; do
          [[ " ${LOCAL_BUILD_SERVICES[*]} " == *" ${token} "* ]] || LOCAL_BUILD_SERVICES+=("${token}")
        done
        ;;
      web|manifest|transcoder)
        [[ " ${LOCAL_BUILD_SERVICES[*]} " == *" ${token} "* ]] || LOCAL_BUILD_SERVICES+=("${token}")
        ;;
      *)
        echo "ERROR: unsupported DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES value: ${token}"
        echo "Use auto, none, all, or a comma-separated list of web,manifest,transcoder."
        exit 1
        ;;
    esac
  done
}

service_selected_for_local_build() {
  local service="$1"
  local selected
  for selected in "${LOCAL_BUILD_SERVICES[@]}"; do
    if [[ "${selected}" == "${service}" ]]; then
      return 0
    fi
  done
  return 1
}

build_local_service_images() {
  if (( ${#LOCAL_BUILD_SERVICES[@]} == 0 )); then
    return
  fi

  echo "🔹 Building app images locally (${DEPLOY_LOCAL_BUILD_PLATFORM}): ${LOCAL_BUILD_SERVICES[*]}"
  (
    cd "${PROJECT_DIR}"
    DOCKER_DEFAULT_PLATFORM="${DEPLOY_LOCAL_BUILD_PLATFORM}" \
      docker compose --env-file .env.production -f docker-compose.yml build "${LOCAL_BUILD_SERVICES[@]}"
  )
}

stream_local_service_images_to_remote() {
  local image_names=()
  local service

  if (( ${#LOCAL_BUILD_SERVICES[@]} == 0 )); then
    return
  fi

  for service in "${LOCAL_BUILD_SERVICES[@]}"; do
    image_names+=("$(service_image_name "${service}")")
  done

  echo "🔹 Streaming local app images to remote: ${LOCAL_BUILD_SERVICES[*]}"
  if [[ "${SSH_MULTIPLEX}" == "1" ]]; then
    docker save "${image_names[@]}" | ssh "${SSH_OPTS[@]}" "${TARGET}" "docker load"
  else
    docker save "${image_names[@]}" | ssh "${TARGET}" "docker load"
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

parse_local_build_services "${DEPLOY_LOCAL_BUILD_SERVICES_RAW}"
REMOTE_BUILD_SERVICES=()
for service in web manifest transcoder xmr-wallet-init xmr-wallet-rpc; do
  if ! service_selected_for_local_build "${service}"; then
    REMOTE_BUILD_SERVICES+=("${service}")
  fi
done
if [[ "${DEPLOY_MIN_FREE_GB_RAW}" == "auto" ]]; then
  remote_requires_heavy_build=0
  for service in "${REMOTE_BUILD_SERVICES[@]}"; do
    case "${service}" in
      web|manifest|transcoder)
        remote_requires_heavy_build=1
        break
        ;;
    esac
  done
  if (( remote_requires_heavy_build == 0 )); then
    DEPLOY_MIN_FREE_GB=2
  else
    DEPLOY_MIN_FREE_GB=4
  fi
else
  DEPLOY_MIN_FREE_GB="${DEPLOY_MIN_FREE_GB_RAW}"
fi

DEPLOY_GIT_HEAD=""
DEPLOY_GIT_BRANCH=""
if command -v git >/dev/null 2>&1 && git -C "${PROJECT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DEPLOY_GIT_HEAD="$(git -C "${PROJECT_DIR}" rev-parse --short HEAD)"
  DEPLOY_GIT_BRANCH="$(git -C "${PROJECT_DIR}" rev-parse --abbrev-ref HEAD)"
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
echo "   source: ${PROJECT_DIR_SOURCE}"
if [[ -n "${DEPLOY_GIT_HEAD}" ]]; then
  echo "   git:    ${DEPLOY_GIT_BRANCH}@${DEPLOY_GIT_HEAD}"
fi
if (( ${#LOCAL_BUILD_SERVICES[@]} > 0 )); then
  echo "   local app images: ${LOCAL_BUILD_SERVICES[*]}"
else
  echo "   local app images: none"
fi
if (( ${#REMOTE_BUILD_SERVICES[@]} > 0 )); then
  echo "   remote service builds: ${REMOTE_BUILD_SERVICES[*]}"
else
  echo "   remote service builds: none"
fi
echo "   remote: ${TARGET}:${REMOTE_DIR}"

if [[ "${DSTREAM_DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "🧪 Dry run complete. Skipping rsync/build/ssh."
  exit 0
fi

echo "🔹 Ensuring remote directory exists..."
run_ssh "${TARGET}" "mkdir -p '${REMOTE_DIR}'"

echo "🔹 Syncing files..."
rsync -az --delete \
  -e "${RSYNC_SSH_CMD}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.turbo' \
  --exclude '.caddy-data' \
  --exclude '.caddy-config' \
  --exclude 'infra/prod/Caddyfile' \
  --exclude '*.log' \
  "${PROJECT_DIR}/" "${TARGET}:${REMOTE_DIR}/"

if [[ "${DEPLOY_DISK_CLEANUP}" == "1" ]]; then
  echo "🔹 Running remote disk cleanup..."
  run_ssh "${TARGET}" "cd '${REMOTE_DIR}' && if [[ -f scripts/ops-disk-cleanup.sh ]]; then bash scripts/ops-disk-cleanup.sh; else echo 'cleanup script missing; skipping'; fi"
fi

echo "🔹 Checking remote disk headroom..."
remote_free_gb="$(
  run_ssh "${TARGET}" "df -BG / | awk 'NR==2 { gsub(/G/, \"\", \$4); print \$4 }'" | tr -d '\r\n'
)"
if [[ ! "${remote_free_gb}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not determine remote free disk space."
  exit 1
fi
echo "   remote free disk: ${remote_free_gb}G"
if (( remote_free_gb < DEPLOY_MIN_FREE_GB )); then
  echo "ERROR: remote free disk ${remote_free_gb}G is below required minimum ${DEPLOY_MIN_FREE_GB}G."
  exit 1
fi

build_local_service_images
stream_local_service_images_to_remote

COMPOSE_ARGS="-f docker-compose.yml"
DEPLOY_REAL_WALLET="${DSTREAM_DEPLOY_REAL_WALLET:-auto}"
if [[ "${DEPLOY_REAL_WALLET}" == "auto" ]]; then
  if grep -Eiq '^DSTREAM_XMR_WALLET_RPC_ORIGIN=.*xmr-wallet-rpc-(receiver|sender)' "${PROJECT_DIR}/.env.production"; then
    DEPLOY_REAL_WALLET="1"
  else
    DEPLOY_REAL_WALLET="0"
  fi
fi
if [[ "${DEPLOY_REAL_WALLET}" == "1" ]]; then
  COMPOSE_ARGS="${COMPOSE_ARGS} -f docker-compose.real-wallet.yml"
fi
echo "🔹 Compose profile: $([[ "${DEPLOY_REAL_WALLET}" == "1" ]] && echo 'real-wallet' || echo 'base')"

echo "🔹 Rebuilding and restarting containers..."
remote_build_csv=""
if (( ${#REMOTE_BUILD_SERVICES[@]} > 0 )); then
  remote_build_csv="$(IFS=,; printf '%s' "${REMOTE_BUILD_SERVICES[*]}")"
fi
run_ssh "${TARGET}" "bash -s -- '${REMOTE_DIR}' '${DEPLOY_REAL_WALLET}' '${remote_build_csv}'" <<'EOS'
set -euo pipefail

remote_dir="$1"
deploy_real_wallet="$2"
remote_build_csv="$3"

compose_args=(-f docker-compose.yml)
if [[ "${deploy_real_wallet}" == "1" ]]; then
  compose_args+=(-f docker-compose.real-wallet.yml)
fi
log_targets=(xmr-wallet-init xmr-wallet-rpc xmr-wallet-rpc-receiver xmr-wallet-rpc-sender monerod-regtest web mediamtx manifest transcoder)

cd "${remote_dir}"

if [[ -n "${remote_build_csv}" ]]; then
  IFS=',' read -r -a remote_build_services <<< "${remote_build_csv}"
  if ! docker compose "${compose_args[@]}" --env-file .env.production build "${remote_build_services[@]}"; then
    echo '--- compose build failure logs (tail 220) ---'
    docker compose "${compose_args[@]}" --env-file .env.production logs --tail 220 "${log_targets[@]}" || true
    exit 1
  fi
fi

if ! docker compose "${compose_args[@]}" --env-file .env.production up -d --remove-orphans; then
  echo '--- compose up failure logs (tail 220) ---'
  docker compose "${compose_args[@]}" --env-file .env.production logs --tail 220 "${log_targets[@]}" || true
  exit 1
fi
EOS

if [[ "${DEPLOY_SELF_HEAL}" == "1" ]]; then
  echo "🔹 Self-healing edge proxy (${DEPLOY_CADDY_CONTAINER})..."
  run_ssh "${TARGET}" "bash -s -- '${REMOTE_DIR}' '${DEPLOY_NETWORK}' '${DEPLOY_CADDY_CONTAINER}' '${DEPLOY_DOMAIN}'" <<'EOS'
set -euo pipefail

remote_dir="$1"
network_name="$2"
caddy_container="$3"
domain="$4"

mkdir -p "${remote_dir}/infra/prod" "${remote_dir}/.caddy-data" "${remote_dir}/.caddy-config"

if [[ ! -s "${remote_dir}/infra/prod/Caddyfile" ]] || grep -q '\${DSTREAM_DOMAIN:-' "${remote_dir}/infra/prod/Caddyfile"; then
  printf '%s\n' "${domain} {" "  reverse_proxy dstream-web-1:5656" "}" > "${remote_dir}/infra/prod/Caddyfile"
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
  -e "DSTREAM_DOMAIN=${domain}" \
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

if [[ "${DEPLOY_SMOKE}" == "1" ]]; then
  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-production-runtime.sh" ]]; then
    echo "ERROR: ${PROJECT_DIR}/scripts/smoke-production-runtime.sh not found."
    exit 1
  fi
  echo "🔹 Running post-deploy production smoke..."
  (
    cd "${PROJECT_DIR}"
    SSH_TARGET="${TARGET}" DSTREAM_DEPLOY_DOMAIN="${DEPLOY_DOMAIN}" bash scripts/smoke-production-runtime.sh "${TARGET}"
  )
fi

if [[ "${SSH_MULTIPLEX}" == "1" ]]; then
  run_ssh -O exit "${TARGET}" >/dev/null 2>&1 || true
fi

echo "✅ Deployment complete."
echo "Next checks:"
echo "  ssh ${TARGET} 'cd ${REMOTE_DIR} && docker compose ${COMPOSE_ARGS} --env-file .env.production ps'"
echo "  ssh ${TARGET} 'cd ${REMOTE_DIR} && docker compose ${COMPOSE_ARGS} --env-file .env.production logs --since 5m web'"
