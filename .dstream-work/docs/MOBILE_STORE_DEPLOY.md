# Mobile Store Deployment (App Store + Google Play)

Last updated: 2026-10-03

This runbook covers signed release builds and store upload for the Capacitor mobile app at `apps/mobile`.

**Current repository status:** release scaffolding only. Generated `apps/mobile/ios` and `apps/mobile/android` projects are not tracked. No signed build, upload, review submission, or store approval is established by this document.

Listing and submission docs:

- `docs/MOBILE_STORE_LISTING_COPY.md`
- `docs/MOBILE_STORE_SUBMISSION_SHEET.md`

## 1) Prerequisites

- macOS with Xcode + command line tools (iOS builds).
- Android SDK + platform tools + JDK (Android builds).
- Ruby + Bundler (for Fastlane).
- Store credentials:
  - App Store Connect API key (`.p8`) with upload permissions.
  - Google Play service account JSON with release permissions.
  - Android release keystore.

## 2) One-time setup

```bash
cd /path/to/dStream/.dstream-work
npm run mobile:release:setup
cd apps/mobile
npx cap add ios
npx cap add android
cd ../..
npm --workspace mobile run sync
```

Generate only platforms supported by the current development host. `mobile:release:setup` installs the Ruby/Fastlane dependencies; it does not create native projects.

Prepare release env file:

```bash
cp apps/mobile/release.env.example apps/mobile/release.env
```

Fill all required values in `apps/mobile/release.env`.

## 3) Validate release config

Structure check:

```bash
cd /path/to/dStream/.dstream-work
npm run check:mobile:store
```

Strict secret/env check (iOS):

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env MOBILE_RELEASE_TARGET=ios MOBILE_RELEASE_STRICT=1 node scripts/check-mobile-store-release.mjs
```

Strict secret/env check (Android):

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env MOBILE_RELEASE_TARGET=android MOBILE_RELEASE_STRICT=1 node scripts/check-mobile-store-release.mjs
```

Strict validation also requires the selected generated native project. A non-strict structure check is not release evidence.

## 4) Optional permission smoke (device/simulator)

iOS simulator permission reset/grant:

```bash
cd /path/to/dStream/.dstream-work
IOS_SIM_UDID=booted IOS_BUNDLE_ID=stream.dstream npm run test:mobile:permissions:ios
```

Android emulator/device permission reset/grant:

```bash
cd /path/to/dStream/.dstream-work
ANDROID_PACKAGE_NAME=stream.dstream npm run test:mobile:permissions:android
```

## 5) Release commands

All commands support `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env`.

### iOS → TestFlight

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:ios:testflight
```

### iOS → App Store submission

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:ios:appstore
```

### Android → Internal testing track (Play Console)

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:android:internal
```

### Android → Production track (Play Console)

```bash
cd /path/to/dStream/.dstream-work
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:android:production
```

## 6) Build artifacts

The pipeline writes artifacts under:

- iOS IPA: `apps/mobile/build/ios/dstream-ios.ipa`
- Android AAB: `apps/mobile/build/android/dstream-release.aab`

## 7) Notes

- `scripts/mobile-release.sh` runs `npm run check:mobile-shell` and `npm --workspace mobile run sync` before invoking Fastlane.
- iOS release lanes are in `apps/mobile/fastlane/Fastfile` (`ios testflight`, `ios appstore`).
- Android release lanes are in `apps/mobile/fastlane/Fastfile` (`android internal`, `android production`).
- Keep `apps/mobile/release.env` untracked; only commit `apps/mobile/release.env.example`.
- Stop before any upload command unless the intended bundle/application record, signing owner, destination track, and current metadata have been verified in the authoritative store account.
