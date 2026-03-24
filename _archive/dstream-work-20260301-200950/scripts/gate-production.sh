#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE_INPUT="${1:-${ENV_FILE:-.env.production}}"
TARGET_INPUT="${2:-${SSH_TARGET:-}}"
EXTERNAL_BASE_URL="${EXTERNAL_BASE_URL:-}"

if [[ -z "${EXTERNAL_BASE_URL}" ]]; then
  echo "Usage: EXTERNAL_BASE_URL=https://stream.example.com scripts/gate-production.sh [env-file] [user@host]"
  echo "   or: EXTERNAL_BASE_URL=... SSH_TARGET=user@host npm run gate:prod -- .env.production"
  exit 1
fi

if [[ -z "${TARGET_INPUT}" ]]; then
  echo "ERROR: missing SSH target."
  echo "Set SSH_TARGET=user@host or pass as second argument."
  exit 1
fi

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE_PATH="${ENV_FILE_INPUT}"
else
  ENV_FILE_PATH="${PROJECT_DIR}/${ENV_FILE_INPUT}"
fi

if [[ ! -f "${ENV_FILE_PATH}" ]]; then
  echo "ERROR: env file not found: ${ENV_FILE_PATH}"
  exit 1
fi

DOMAIN_DEFAULT="$(printf '%s' "${EXTERNAL_BASE_URL}" | sed -E 's#^https?://([^/:]+).*$#\1#')"
DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-${DOMAIN_DEFAULT}}"
if [[ -z "${DOMAIN}" || "${DOMAIN}" == "${EXTERNAL_BASE_URL}" ]]; then
  echo "ERROR: could not derive domain from EXTERNAL_BASE_URL=${EXTERNAL_BASE_URL}"
  echo "Set DSTREAM_DEPLOY_DOMAIN explicitly."
  exit 1
fi

echo "dStream production gate"
echo "  env file: ${ENV_FILE_PATH}"
echo "  external: ${EXTERNAL_BASE_URL}"
echo "  ssh target: ${TARGET_INPUT}"
echo "  domain: ${DOMAIN}"
echo

(
  cd "${PROJECT_DIR}"
  echo "🔹 harden:deploy"
  HARDEN_MODE=deploy ENV_FILE="${ENV_FILE_PATH}" node scripts/harden-check.mjs

  echo
  echo "🔹 smoke:external:readiness"
  EXTERNAL_BASE_URL="${EXTERNAL_BASE_URL}" node scripts/smoke-external-readiness.mjs

  echo
  echo "🔹 smoke:prod:runtime"
  SSH_TARGET="${TARGET_INPUT}" DSTREAM_DEPLOY_DOMAIN="${DOMAIN}" bash scripts/smoke-production-runtime.sh "${TARGET_INPUT}"
)

echo
echo "PASS: production gate complete"
