#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around the canonical repo-root deploy script.
# Pins DSTREAM_DEPLOY_PROJECT_DIR to this workspace unless the caller overrides it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT_DEPLOY_SCRIPT="$(cd "${SCRIPT_DIR}/../../../infra/prod" && pwd)/deploy.sh"

if [[ ! -f "${ROOT_DEPLOY_SCRIPT}" ]]; then
  echo "ERROR: root deploy script not found at ${ROOT_DEPLOY_SCRIPT}"
  exit 1
fi

export DSTREAM_DEPLOY_PROJECT_DIR="${DSTREAM_DEPLOY_PROJECT_DIR:-${PROJECT_DIR}}"
exec "${ROOT_DEPLOY_SCRIPT}" "$@"
