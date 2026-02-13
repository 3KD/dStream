# Mobile Release Checklist (iOS + Android)

Use this checklist before publishing a mobile build that points to production edge infrastructure.

## Preflight

- Confirm mobile config persistence:
  - Native storage path: Capacitor Preferences
  - Fallback path: browser localStorage
- Confirm relay defaults are valid `wss://` URLs.
- Confirm edge URL resolves and serves `/mobile/bootstrap`.
- Run:
  - `npm run check:mobile`
  - `npm run test:mobile:permissions`
  - `npm --workspace mobile run sync`

## iOS permission flow

Run on a clean install (simulator or device):

1. Launch app, configure edge + relays, then open broadcast.
2. Verify iOS camera prompt appears.
3. Verify iOS microphone prompt appears.
4. Deny both permissions and confirm user-facing guidance appears (no crash).
5. Re-open app, grant camera + microphone, confirm local preview initializes.
6. Start stream and verify `/watch/:npub/:streamId` playback from a second client.

## Android permission flow

Run on a clean install (emulator or device):

1. Launch app, configure edge + relays, then open broadcast.
2. Verify Android camera + microphone runtime permission dialogs appear.
3. Deny both permissions and confirm user-facing guidance appears (no crash).
4. Grant camera + microphone and confirm local preview initializes.
5. Start stream and verify `/watch/:npub/:streamId` playback from a second client.

## Visual regression evidence

- Golden check: `npm run check:mobile:golden`
- If intentional shell UI changes were made, update baseline:
  - `npm run check:mobile:golden:update`
- Capture evidence screenshots for:
  - first-run setup screen
  - saved-config screen
  - Node & Relays edit mode

## Release evidence bundle

Record and attach:

- build commit SHA
- platform + OS version used for verification
- permission-flow pass/fail notes for iOS + Android
- stream publish + watch proof (stream ID + timestamp)
- output from `npm run check:mobile`
