#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "${DSTREAM_RESTORE_FORCE:-0}" != "1" ]]; then
  echo "ERROR: restore is destructive. Re-run with DSTREAM_RESTORE_FORCE=1."
  exit 1
fi

TARGET="${SSH_TARGET:-}"
BACKUP_SOURCE="${1:-}"

if [[ -z "${BACKUP_SOURCE}" ]]; then
  echo "Usage: DSTREAM_RESTORE_FORCE=1 scripts/ops-restore.sh <backup-dir-or-archive>"
  echo "   or: DSTREAM_RESTORE_FORCE=1 SSH_TARGET=user@host DSTREAM_REMOTE_DIR=/opt/dstream scripts/ops-restore.sh <remote-backup-path>"
  exit 1
fi

REMOTE_DIR="${DSTREAM_REMOTE_DIR:-/opt/dstream}"

if [[ -n "${TARGET}" ]]; then
  echo "Running remote restore on ${TARGET}:${REMOTE_DIR}"
  ssh "${TARGET}" "cd '${REMOTE_DIR}' && DSTREAM_RESTORE_FORCE=1 SSH_TARGET='' bash scripts/ops-restore.sh '${BACKUP_SOURCE}'"
  exit 0
fi

resolve_source() {
  local input="$1"
  if [[ "${input}" = /* ]]; then
    printf '%s' "${input}"
  else
    printf '%s' "${PROJECT_DIR}/${input}"
  fi
}

SOURCE_PATH="$(resolve_source "${BACKUP_SOURCE}")"
if [[ ! -e "${SOURCE_PATH}" ]]; then
  echo "ERROR: backup source not found: ${SOURCE_PATH}"
  exit 1
fi

TEMP_DIR=""
SOURCE_DIR="${SOURCE_PATH}"
cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

if [[ -f "${SOURCE_PATH}" ]]; then
  TEMP_DIR="$(mktemp -d)"
  tar -xzf "${SOURCE_PATH}" -C "${TEMP_DIR}"
  first_dir="$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
  if [[ -z "${first_dir}" ]]; then
    echo "ERROR: archive does not contain a backup directory."
    exit 1
  fi
  SOURCE_DIR="${first_dir}"
fi

FILES_DIR="${SOURCE_DIR}/files"
VOLUMES_DIR="${SOURCE_DIR}/volumes"
if [[ ! -d "${FILES_DIR}" ]]; then
  echo "ERROR: invalid backup format (missing files directory): ${FILES_DIR}"
  exit 1
fi

echo "dStream restore"
echo "  source: ${SOURCE_DIR}"
echo "  project: ${PROJECT_DIR}"

while IFS= read -r file; do
  rel="${file#${FILES_DIR}/}"
  if [[ "${rel}" == "caddy-data.tgz" || "${rel}" == "caddy-config.tgz" ]]; then
    continue
  fi
  mkdir -p "${PROJECT_DIR}/$(dirname "${rel}")"
  cp "${file}" "${PROJECT_DIR}/${rel}"
done < <(find "${FILES_DIR}" -type f)

if [[ -f "${FILES_DIR}/caddy-data.tgz" ]]; then
  rm -rf "${PROJECT_DIR}/.caddy-data"
  tar -xzf "${FILES_DIR}/caddy-data.tgz" -C "${PROJECT_DIR}"
fi
if [[ -f "${FILES_DIR}/caddy-config.tgz" ]]; then
  rm -rf "${PROJECT_DIR}/.caddy-config"
  tar -xzf "${FILES_DIR}/caddy-config.tgz" -C "${PROJECT_DIR}"
fi

if [[ -d "${VOLUMES_DIR}" ]]; then
  while IFS= read -r archive; do
    volume="$(basename "${archive}" .tgz)"
    docker volume create "${volume}" >/dev/null
    docker run --rm \
      -v "${volume}:/to" \
      -v "${VOLUMES_DIR}:/from:ro" \
      alpine:3.20 \
      sh -c "find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -xzf \"/from/$(basename "${archive}")\" -C /to"
    echo "  restored volume: ${volume}"
  done < <(find "${VOLUMES_DIR}" -type f -name '*.tgz' | sort)
fi

echo "Restore complete."
echo "Next: restart services (for example: docker compose --env-file .env.production up -d --build --remove-orphans)."
