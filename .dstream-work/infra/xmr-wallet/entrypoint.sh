#!/bin/sh
set -eu

wallet_file_pass="${DSTREAM_XMR_WALLET_FILE_PASS:-}"
if [ -z "$wallet_file_pass" ]; then
  wallet_file_pass="${DSTREAM_XMR_WALLET_RPC_PASS:-dstream-default-password}"
fi
has_password_flag=0

for arg in "$@"; do
  case "$arg" in
    --password|--password=*)
      has_password_flag=1
      ;;
  esac
done

if [ "$has_password_flag" -eq 1 ]; then
  exec monero-wallet-rpc "$@"
fi

exec monero-wallet-rpc --password="$wallet_file_pass" "$@"
