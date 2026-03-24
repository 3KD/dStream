#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <ios|android>"
  exit 1
fi

TARGET="$1"
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-stream.dstream}"
ANDROID_PACKAGE_NAME="${ANDROID_PACKAGE_NAME:-stream.dstream}"

run_ios() {
  if ! command -v xcrun >/dev/null 2>&1; then
    echo "ERROR: xcrun is required for iOS permission smoke."
    exit 1
  fi

  local sim_target
  sim_target="${IOS_SIM_UDID:-booted}"

  if [ "$sim_target" = "booted" ]; then
    if ! xcrun simctl list devices booted | grep -q "Booted"; then
      echo "ERROR: no booted iOS simulator. Boot one or set IOS_SIM_UDID."
      exit 1
    fi
  fi

  echo "iOS permission smoke: simulator=$sim_target bundle=$IOS_BUNDLE_ID"
  xcrun simctl privacy "$sim_target" reset all "$IOS_BUNDLE_ID" || true
  xcrun simctl privacy "$sim_target" revoke camera "$IOS_BUNDLE_ID" || true
  xcrun simctl privacy "$sim_target" revoke microphone "$IOS_BUNDLE_ID" || true

  if [ "${IOS_GRANT_AFTER_RESET:-1}" = "1" ]; then
    xcrun simctl privacy "$sim_target" grant camera "$IOS_BUNDLE_ID"
    xcrun simctl privacy "$sim_target" grant microphone "$IOS_BUNDLE_ID"
  fi

  echo "PASS: iOS permission reset/grant sequence complete."
}

run_android() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "ERROR: adb is required for Android permission smoke."
    exit 1
  fi

  if ! adb get-state >/dev/null 2>&1; then
    echo "ERROR: no connected Android emulator/device."
    exit 1
  fi

  if ! adb shell pm path "$ANDROID_PACKAGE_NAME" >/dev/null 2>&1; then
    echo "ERROR: app package not installed on device: $ANDROID_PACKAGE_NAME"
    exit 1
  fi

  echo "Android permission smoke: package=$ANDROID_PACKAGE_NAME"
  adb shell pm revoke "$ANDROID_PACKAGE_NAME" android.permission.CAMERA || true
  adb shell pm revoke "$ANDROID_PACKAGE_NAME" android.permission.RECORD_AUDIO || true

  if [ "${ANDROID_GRANT_AFTER_RESET:-1}" = "1" ]; then
    adb shell pm grant "$ANDROID_PACKAGE_NAME" android.permission.CAMERA
    adb shell pm grant "$ANDROID_PACKAGE_NAME" android.permission.RECORD_AUDIO
  fi

  echo "PASS: Android permission reset/grant sequence complete."
}

case "$TARGET" in
  ios) run_ios ;;
  android) run_android ;;
  *)
    echo "ERROR: unsupported target '$TARGET' (use ios|android)."
    exit 1
    ;;
esac
