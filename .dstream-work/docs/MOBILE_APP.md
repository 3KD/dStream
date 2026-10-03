# Mobile App (iOS + Android)

The mobile app lives at `apps/mobile` and follows ADR `0028`.

**Current status:** source shell and release scaffolding only. The generated native projects are not tracked, and the repository does not by itself prove a signed or store-published mobile release.

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
- Fastlane configuration and upload commands are present for locally generated, signed native projects:
  - `npm run mobile:release:ios:testflight`
  - `npm run mobile:release:ios:appstore`
  - `npm run mobile:release:android:internal`
  - `npm run mobile:release:android:production`
- Release verification checklist (`docs/MOBILE_RELEASE_CHECKLIST.md`).
- Store deployment runbook (`docs/MOBILE_STORE_DEPLOY.md`).

Before describing mobile broadcast or playback as released behavior, complete the real-device checklist on both platforms and record the resulting artifact/version evidence.
