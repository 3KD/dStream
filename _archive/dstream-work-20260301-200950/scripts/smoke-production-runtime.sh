#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${SSH_TARGET:-}}"
REMOTE_DIR="${DSTREAM_REMOTE_DIR:-/opt/dstream}"
DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-dstream.stream}"

if [[ -z "${TARGET}" ]]; then
  echo "Usage: scripts/smoke-production-runtime.sh user@host"
  echo "   or: SSH_TARGET=user@host npm run smoke:prod:runtime"
  exit 1
fi

echo "dStream production runtime smoke"
echo "  target: ${TARGET}"
echo "  remote: ${REMOTE_DIR}"
echo "  domain: ${DOMAIN}"
echo

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "🔹 Checking remote stack status..."
ssh "${TARGET}" "cd '${REMOTE_DIR}' && docker compose -f docker-compose.yml --env-file .env.production ps" >/tmp/dstream-prod-ps.txt
cat /tmp/dstream-prod-ps.txt

if ! grep -qE 'dstream-web-1|web' /tmp/dstream-prod-ps.txt; then
  fail "web container not present in compose ps output"
fi
if ! grep -qE 'dstream-turn-1|turn' /tmp/dstream-prod-ps.txt; then
  fail "turn container not present in compose ps output"
fi

echo
echo "🔹 Checking remote internal web health..."
local_web_code="$(
  ssh "${TARGET}" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5656/settings"
)"
if [[ "${local_web_code}" != "200" ]]; then
  fail "internal web health check failed (expected 200, got ${local_web_code})"
fi

echo "🔹 Inspecting remote production env..."
remote_env="$(
  ssh "${TARGET}" "cd '${REMOTE_DIR}' && sed -n '1,260p' .env.production"
)"

if echo "${remote_env}" | grep -qiE 'NEXT_PUBLIC_WEBRTC_ICE_SERVERS=.*turn\.example\.com'; then
  fail "remote .env.production still uses turn.example.com"
fi
if echo "${remote_env}" | grep -qiE 'TURN_PASSWORD=.*(replace-turn-password|changeme|example)'; then
  fail "remote .env.production still uses a placeholder TURN password"
fi
if echo "${remote_env}" | grep -qiE '^TURN_EXTERNAL_IP=$'; then
  fail "remote .env.production has empty TURN_EXTERNAL_IP"
fi

if echo "${remote_env}" | grep -qiE 'DSTREAM_XMR_WALLET_RPC_ORIGIN=.*xmr-mock'; then
  fail "remote .env.production still uses xmr-mock wallet RPC"
fi

if echo "${remote_env}" | grep -qiE 'DSTREAM_XMR_SESSION_SECRET=.*(replace|change-before-public-deploy|changeme|example)'; then
  fail "remote .env.production still uses a placeholder session secret"
fi

echo
echo "🔹 Checking public endpoints..."
for path in / /browse /broadcast /settings /analytics /docs /donate; do
  code="$(curl -k -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}${path}")"
  echo "  ${path} ${code}"
  if [[ "${code}" != "200" ]]; then
    fail "public endpoint ${path} is unhealthy (${code})"
  fi
done

echo
echo "PASS: production runtime smoke checks complete"
