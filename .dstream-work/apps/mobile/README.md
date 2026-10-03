# dStream Mobile Shell (iOS + Android)

This package is a Capacitor shell that ships dStream as a mobile app while preserving the decentralization model:

- the phone runs the app UI,
- a user-owned edge node (VPS/home server) runs ingest/origin services.

## Status

This repository contains the web shell, Capacitor configuration, checks, and release-script scaffolding. Generated `ios/` and `android/` projects are intentionally untracked. No signed build, real-device pass, TestFlight upload, Play upload, or store approval is established by this source tree alone.

## What this scaffold includes

- First-run setup screen (`www/index.html`) for:
  - edge node URL
  - relay list
- Launch flow to `<edge>/mobile/bootstrap` with relay override payload.
- Capacitor config (`capacitor.config.ts`) for iOS and Android targets.
- Native config persistence via Capacitor Preferences (with browser `localStorage` fallback).
- Post-setup **Node & Relays** editor from the saved-config screen.

## Prerequisites

- Xcode (for iOS builds)
- Android Studio + SDK (for Android builds)

## Commands

```bash
cd apps/mobile
npm install
npx cap add ios
npx cap add android
npm run sync
npm run open:ios
npm run open:android
```

Generate only the platform available on the current development host. The generated native directories remain local unless the project deliberately changes that policy.

Root-level validation:

```bash
cd ../..
npm run check:mobile-shell
npm run check:mobile:golden
npm run check:mobile
```

Store-release automation:

```bash
cd ../..
npm run mobile:release:setup
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:ios:testflight
MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:android:internal
```

See:

- `docs/MOBILE_STORE_DEPLOY.md`
- `docs/MOBILE_RELEASE_CHECKLIST.md`

Release commands require generated native projects, valid signing material, store credentials, and successful real-device acceptance. The committed shell checks do not substitute for those gates.

## Runtime notes

- Mobile setup stores app config under `dstream_mobile_config_v1`.
  - Native app: Capacitor Preferences store.
  - Browser fallback: `localStorage`.
- No default hosted edge URL is prefilled; users point the app at their own node first.
- Web relay override is written by `/mobile/bootstrap` into the web app storage key `dstream_nostr_relays_override_v1`.
- To update saved edge/relay values after first launch, use the **Node & Relays** button.
- To clear mobile-side setup, use the `Reset` button in the mobile shell screen.
- Release verification checklist (permissions + evidence): `docs/MOBILE_RELEASE_CHECKLIST.md`.
