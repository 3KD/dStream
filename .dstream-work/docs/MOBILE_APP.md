# Mobile App (iOS + Android)

The mobile app lives at `apps/mobile` and follows ADR `0028`.

## Model

- iOS/Android app package is the client surface.
- User-owned edge node is still the media seed/origin authority.
- Relays are configurable by the user at first launch.

## Current implementation

- Capacitor shell for iOS + Android.
- First-run setup page for:
  - edge node URL
  - relay list
- Native config persistence via Capacitor Preferences (fallback to localStorage when not native).
- In-app post-setup “Node & Relays” editor available from saved-config mode.
- Bootstrap handoff to web route:
  - `GET /mobile/bootstrap?relays=...&next=/`
- Broadcast permission flow normalization for camera/mic failures (unit-tested).
- CI validation for mobile shell assets/config (`npm run check:mobile-shell`).
- Golden UI regression baseline for mobile shell (`npm run check:mobile:golden`).
- Device permission automation helpers:
  - `npm run test:mobile:permissions:ios`
  - `npm run test:mobile:permissions:android`
- Signed build and store upload automation via Fastlane:
  - `npm run mobile:release:ios:testflight`
  - `npm run mobile:release:ios:appstore`
  - `npm run mobile:release:android:internal`
  - `npm run mobile:release:android:production`
- Release verification checklist (`docs/MOBILE_RELEASE_CHECKLIST.md`).
- Store deployment runbook (`docs/MOBILE_STORE_DEPLOY.md`).
