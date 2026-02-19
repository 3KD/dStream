# Mobile Store Submission Sheet

Last updated: 2026-02-16

Use this as the release operator worksheet before pressing submit on iOS and Android.

## 1) Identity and package fields

### iOS (App Store Connect)

- App Name: `dStream`
- Bundle ID: `stream.dstream`
- SKU (recommended): `dstream-ios-main-001`
- Primary language: `English (U.S.)`
- Availability: all intended countries/regions

### Android (Google Play Console)

- App Name: `dStream`
- Application ID / package: `stream.dstream`
- Default language: `en-US`
- Category: `Social` (or `Entertainment`, choose one and keep consistent)

## 2) Listing text source

- Use copy from: `docs/MOBILE_STORE_LISTING_COPY.md`
- Keep iOS and Play positioning aligned to avoid review mismatch.

## 3) Mandatory store URLs

- Marketing URL: `https://dstream.stream`
- Support URL: `https://dstream.stream/docs`
- Privacy URL: `https://dstream.stream/privacy`
- Terms URL (review notes/reference): `https://dstream.stream/terms`
- Community Guidelines URL (review notes/reference): `https://dstream.stream/community-guidelines`

## 4) Secrets/config gate (must pass)

1. Copy env template:
   - `cp apps/mobile/release.env.example apps/mobile/release.env`
2. Fill real values in `apps/mobile/release.env`.
3. Run strict checks:
   - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env MOBILE_RELEASE_TARGET=ios MOBILE_RELEASE_STRICT=1 node scripts/check-mobile-store-release.mjs`
   - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env MOBILE_RELEASE_TARGET=android MOBILE_RELEASE_STRICT=1 node scripts/check-mobile-store-release.mjs`

## 5) Build/test gate (must pass)

- `npm run check:mobile:store`
- `npm run check:mobile`
- `npm run test:mobile:permissions:ios`
- `npm run test:mobile:permissions:android`

If `check:mobile` fails due to intentional shell UI updates, refresh baseline:

- `npm run check:mobile:golden:update`

Then rerun:

- `npm run check:mobile`

## 6) Functional acceptance (real devices/networks)

Run one full pass for each platform:

1. Launch app from clean install.
2. Configure edge + relays.
3. Grant camera + microphone.
4. Start broadcast from Device A.
5. Watch from Device B on different network.
6. Chat send/receive.
7. Submit abuse report (stream/user/message).
8. Confirm moderation inbox can review/resolve report.

Record:

- Stream ID
- Timestamp
- Device model + OS version
- Result (pass/fail) per step

## 7) Compliance artifacts to attach

- Screenshots:
  - first-run node/relay setup
  - broadcast screen
  - watch + chat screen
  - report modal
  - moderation inbox view
- Policy proof:
  - `/privacy`
  - `/terms`
  - `/community-guidelines`
- Reviewer note:
  - use text block from `docs/MOBILE_STORE_LISTING_COPY.md`

## 8) Upload commands

### iOS

- TestFlight:
  - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:ios:testflight`
- App Store:
  - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:ios:appstore`

### Android

- Internal track:
  - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:android:internal`
- Production track:
  - `MOBILE_RELEASE_ENV_FILE=apps/mobile/release.env npm run mobile:release:android:production`

## 9) Final “go/no-go” checklist

- [ ] Strict env checks pass for iOS and Android.
- [ ] Mobile checks/tests pass.
- [ ] Real-device acceptance pass completed and logged.
- [ ] Listing text finalized from `docs/MOBILE_STORE_LISTING_COPY.md`.
- [ ] Data Safety/App Privacy answers match implemented behavior.
- [ ] Store screenshots uploaded and current.
- [ ] Rollback contact and incident owner assigned.
