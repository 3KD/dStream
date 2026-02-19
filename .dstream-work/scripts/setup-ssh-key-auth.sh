#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${SSH_TARGET:-}}"
PUBKEY_FILE="${2:-${DSTREAM_SSH_PUBKEY_FILE:-$HOME/.ssh/id_ed25519.pub}}"
DISABLE_PASSWORD_AUTH="${DSTREAM_DISABLE_PASSWORD_AUTH:-0}"
ALLOW_LOCKOUT_RISK="${DSTREAM_ALLOW_LOCKOUT_RISK:-0}"

if [[ -z "${TARGET}" ]]; then
  echo "Usage: scripts/setup-ssh-key-auth.sh user@host [pubkey-file]"
  echo "   or: SSH_TARGET=user@host npm run ops:ssh:key"
  exit 1
fi

if [[ ! -f "${PUBKEY_FILE}" ]]; then
  echo "ERROR: public key not found: ${PUBKEY_FILE}"
  exit 1
fi

PUBKEY="$(tr -d '\r\n' < "${PUBKEY_FILE}")"
if [[ -z "${PUBKEY}" ]]; then
  echo "ERROR: public key file is empty: ${PUBKEY_FILE}"
  exit 1
fi
PUBKEY_ESCAPED="$(printf '%s' "${PUBKEY}" | sed "s/'/'\\\\''/g")"

echo "Installing SSH key on ${TARGET}"
ssh "${TARGET}" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
ssh "${TARGET}" "grep -qxF '${PUBKEY_ESCAPED}' ~/.ssh/authorized_keys || echo '${PUBKEY_ESCAPED}' >> ~/.ssh/authorized_keys"

echo "Verifying key-based login..."
ssh -o BatchMode=yes -o PreferredAuthentications=publickey "${TARGET}" "echo key-auth-ok" >/dev/null
echo "PASS: key authentication works."

if [[ "${DISABLE_PASSWORD_AUTH}" == "1" ]]; then
  if [[ "${ALLOW_LOCKOUT_RISK}" != "1" ]]; then
    echo "ERROR: refusing to disable password auth without DSTREAM_ALLOW_LOCKOUT_RISK=1."
    exit 1
  fi

  echo "Disabling SSH password auth on remote host..."
  ssh "${TARGET}" "bash -s" <<'EOS'
set -euo pipefail
sshd_config="/etc/ssh/sshd_config"
backup="${sshd_config}.bak.$(date +%Y%m%d%H%M%S)"
cp "${sshd_config}" "${backup}"

if grep -qE '^[#[:space:]]*PasswordAuthentication[[:space:]]+' "${sshd_config}"; then
  sed -i 's/^[#[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication no/' "${sshd_config}"
else
  echo 'PasswordAuthentication no' >> "${sshd_config}"
fi

if grep -qE '^[#[:space:]]*ChallengeResponseAuthentication[[:space:]]+' "${sshd_config}"; then
  sed -i 's/^[#[:space:]]*ChallengeResponseAuthentication[[:space:]].*/ChallengeResponseAuthentication no/' "${sshd_config}"
else
  echo 'ChallengeResponseAuthentication no' >> "${sshd_config}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload ssh || systemctl reload sshd || systemctl restart ssh || systemctl restart sshd
else
  service ssh reload || service sshd reload || service ssh restart || service sshd restart
fi
EOS

  ssh -o BatchMode=yes -o PreferredAuthentications=publickey "${TARGET}" "echo key-auth-after-hardening-ok" >/dev/null
  echo "PASS: password auth disabled and key auth verified."
fi
