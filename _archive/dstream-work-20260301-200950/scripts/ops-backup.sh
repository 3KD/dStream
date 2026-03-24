#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET="${1:-${SSH_TARGET:-}}"
REMOTE_DIR="${DSTREAM_REMOTE_DIR:-/opt/dstream}"

if [[ -n "${TARGET}" ]]; then
  echo "Running remote backup on ${TARGET}:${REMOTE_DIR}"
  ssh "${TARGET}" "cd '${REMOTE_DIR}' && DSTREAM_BACKUP_ROOT='${DSTREAM_BACKUP_ROOT:-${REMOTE_DIR}/backups}' DSTREAM_BACKUP_RETENTION_DAYS='${DSTREAM_BACKUP_RETENTION_DAYS:-}' DSTREAM_BACKUP_ARCHIVE='${DSTREAM_BACKUP_ARCHIVE:-1}' SSH_TARGET='' bash scripts/ops-backup.sh"
  exit 0
fi

BACKUP_ROOT="${DSTREAM_BACKUP_ROOT:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${DSTREAM_BACKUP_RETENTION_DAYS:-}"
CREATE_ARCHIVE="${DSTREAM_BACKUP_ARCHIVE:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_ROOT}/${STAMP}"
FILES_DIR="${OUT_DIR}/files"
VOLUMES_DIR="${OUT_DIR}/volumes"

mkdir -p "${FILES_DIR}" "${VOLUMES_DIR}"

echo "dStream backup"
echo "  project: ${PROJECT_DIR}"
echo "  output: ${OUT_DIR}"

copy_file_if_exists() {
  local rel="$1"
  local src="${PROJECT_DIR}/${rel}"
  if [[ ! -f "${src}" ]]; then
    return
  fi
  mkdir -p "${FILES_DIR}/$(dirname "${rel}")"
  cp "${src}" "${FILES_DIR}/${rel}"
}

copy_file_if_exists ".env.production"
copy_file_if_exists "docker-compose.yml"
copy_file_if_exists "docker-compose.real-wallet.yml"
copy_file_if_exists "infra/prod/Caddyfile"

if [[ -d "${PROJECT_DIR}/.caddy-data" ]]; then
  tar -czf "${FILES_DIR}/caddy-data.tgz" -C "${PROJECT_DIR}" ".caddy-data"
fi
if [[ -d "${PROJECT_DIR}/.caddy-config" ]]; then
  tar -czf "${FILES_DIR}/caddy-config.tgz" -C "${PROJECT_DIR}" ".caddy-config"
fi

mapfile -t volume_names < <(
  docker volume ls --format '{{.Name}}' | grep -E '(dstream.*(xmr|monero|wallet|caddy)|xmr|monero|wallet|caddy)' | sort -u || true
)

for volume in "${volume_names[@]}"; do
  echo "  volume: ${volume}"
  docker run --rm \
    -v "${volume}:/from:ro" \
    -v "${VOLUMES_DIR}:/to" \
    alpine:3.20 \
    sh -c "tar -czf \"/to/${volume}.tgz\" -C /from ."
done

{
  echo "timestamp=${STAMP}"
  echo "project_dir=${PROJECT_DIR}"
  echo "volume_count=${#volume_names[@]}"
  if [[ ${#volume_names[@]} -gt 0 ]]; then
    printf 'volumes=%s\n' "$(IFS=,; echo "${volume_names[*]}")"
  else
    echo "volumes="
  fi
} > "${OUT_DIR}/manifest.txt"

if [[ "${CREATE_ARCHIVE}" == "1" ]]; then
  tar -czf "${BACKUP_ROOT}/${STAMP}.tgz" -C "${BACKUP_ROOT}" "${STAMP}"
  echo "archive: ${BACKUP_ROOT}/${STAMP}.tgz"
fi

if [[ -n "${RETENTION_DAYS}" ]]; then
  if [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
    find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +
    find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type f -name '*.tgz' -mtime "+${RETENTION_DAYS}" -delete
  else
    echo "WARN: ignoring invalid DSTREAM_BACKUP_RETENTION_DAYS=${RETENTION_DAYS}"
  fi
fi

echo "backup dir: ${OUT_DIR}"
