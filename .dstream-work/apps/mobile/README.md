# dStream Mobile Shell (iOS + Android)

This package is a Capacitor shell that ships dStream as a mobile app while preserving the decentralization model:

- the phone runs the app UI,
- a user-owned edge node (VPS/home server) runs ingest/origin services.

## What this scaffold includes

- First-run setup screen (`www/index.html`) for:
  - edge node URL
  - relay list
- Launch flow to `<edge>/mobile/bootstrap` with relay override payload.
- Capacitor project config (`capacitor.config.ts`) for both iOS and Android targets.
- Native config persistence via Capacitor Preferences (with browser `localStorage` fallback).
- Post-setup **Node & Relays** editor from the saved-config screen.

## Prerequisites

- Xcode (for iOS builds)
- Android Studio + SDK (for Android builds)

## Commands

```bash
cd apps/mobile
npm install
npm run sync
npm run open:ios
npm run open:android
```

Root-level validation:

```bash
cd ../..
npm run check:mobile-shell
npm run check:mobile:golden
npm run check:mobile
```

## Runtime notes

- Mobile setup stores app config under `dstream_mobile_config_v1`.
  - Native app: Capacitor Preferences store.
  - Browser fallback: `localStorage`.
- No default hosted edge URL is prefilled; users point the app at their own node first.
- Web relay override is written by `/mobile/bootstrap` into the web app storage key `dstream_nostr_relays_override_v1`.
- To update saved edge/relay values after first launch, use the **Node & Relays** button.
- To clear mobile-side setup, use the `Reset` button in the mobile shell screen.
- Release verification checklist (permissions + evidence): `docs/MOBILE_RELEASE_CHECKLIST.md`.
