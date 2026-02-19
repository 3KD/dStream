#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <ios|android> <lane>"
  echo "Examples:"
  echo "  $0 ios testflight"
  echo "  $0 ios appstore"
  echo "  $0 android internal"
  echo "  $0 android production"
  exit 1
fi

PLATFORM="$1"
LANE="$2"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

if [ -n "${MOBILE_RELEASE_ENV_FILE:-}" ]; then
  ENV_FILE_PATH="$MOBILE_RELEASE_ENV_FILE"
  case "$ENV_FILE_PATH" in
    /*) ;;
    *) ENV_FILE_PATH="$ROOT_DIR/$ENV_FILE_PATH" ;;
  esac
  if [ ! -f "$ENV_FILE_PATH" ]; then
    echo "ERROR: MOBILE_RELEASE_ENV_FILE not found: $ENV_FILE_PATH"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE_PATH"
  set +a
fi

case "$PLATFORM" in
  ios|android) ;;
  *)
    echo "ERROR: unsupported platform '$PLATFORM' (use ios|android)."
    exit 1
    ;;
esac

cd "$ROOT_DIR"
npm run check:mobile-shell
npm --workspace mobile run sync

if ! command -v fastlane >/dev/null 2>&1 && ! command -v bundle >/dev/null 2>&1; then
  echo "ERROR: fastlane or bundler is required."
  echo "Run:"
  echo "  npm run mobile:release:setup"
  exit 1
fi

cd "$MOBILE_DIR"

if [ -f "Gemfile" ] && command -v bundle >/dev/null 2>&1; then
  bundle exec fastlane "$PLATFORM" "$LANE"
else
  fastlane "$PLATFORM" "$LANE"
fi
