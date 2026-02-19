#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"

if ! command -v bundle >/dev/null 2>&1; then
  echo "ERROR: bundler is required. Install Ruby bundler first."
  echo "       gem install bundler"
  exit 1
fi

cd "$MOBILE_DIR"
export BUNDLE_PATH="${BUNDLE_PATH:-vendor/bundle}"
bundle config set --local path "$BUNDLE_PATH"
bundle install --path "$BUNDLE_PATH"

echo "PASS: mobile release Ruby dependencies installed (apps/mobile/vendor/bundle)."
