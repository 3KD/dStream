#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${SSH_TARGET:-}}"
REMOTE_DIR="${DSTREAM_REMOTE_DIR:-/opt/dstream}"
DOMAIN="${DSTREAM_DEPLOY_DOMAIN:-dstream.stream}"
SCHEDULE="${DSTREAM_HEALTHCHECK_SCHEDULE:-*/5 * * * *}"
WEBHOOK_URL="${DSTREAM_ALERT_WEBHOOK_URL:-}"

if [[ -z "${TARGET}" ]]; then
  echo "Usage: scripts/ops-install-healthcheck-cron.sh user@host"
  echo "   or: SSH_TARGET=user@host npm run ops:healthcheck:install"
  exit 1
fi

echo "Installing remote healthcheck cron"
echo "  target: ${TARGET}"
echo "  remote: ${REMOTE_DIR}"
echo "  schedule: ${SCHEDULE}"
echo "  domain: ${DOMAIN}"

ssh "${TARGET}" "bash -s -- '${REMOTE_DIR}' '${SCHEDULE}' '${DOMAIN}' '${WEBHOOK_URL}'" <<'EOS'
set -euo pipefail

remote_dir="$1"
schedule="$2"
domain="$3"
webhook_url="$4"
health_script="${remote_dir}/scripts/ops-healthcheck.sh"

if [[ ! -f "${health_script}" ]]; then
  echo "ERROR: ${health_script} not found. Deploy first so scripts are available on host."
  exit 1
fi
chmod +x "${health_script}" || true

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

line="${schedule} cd $(shell_quote "${remote_dir}") && DSTREAM_DEPLOY_DOMAIN=$(shell_quote "${domain}")"
if [[ -n "${webhook_url}" ]]; then
  line="${line} DSTREAM_ALERT_WEBHOOK_URL=$(shell_quote "${webhook_url}")"
fi
line="${line} bash scripts/ops-healthcheck.sh >> /var/log/dstream-healthcheck.log 2>&1 # dstream-healthcheck"

tmp_file="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'dstream-healthcheck' > "${tmp_file}" || true
echo "${line}" >> "${tmp_file}"
crontab "${tmp_file}"
rm -f "${tmp_file}"

echo "Installed:"
echo "${line}"
EOS

echo "Done."
