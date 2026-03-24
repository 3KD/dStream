# Mobile Store Metadata Matrix (iOS + Android)

Last updated: 2026-02-16

Purpose: keep App Store Connect and Google Play metadata aligned with shipped behavior.

## 1) Content rating targets

Use conservative defaults unless your moderation policy requires stricter categories.

- iOS age rating: `17+` (recommended for open UGC live chat/video)
- Google Play content rating: complete IARC questionnaire as UGC/social app

## 2) iOS App Privacy (recommended baseline)

Mark as collected only when the app actually transmits/stores it beyond device-local use.

- Contact info: `No` (unless support/account email collection is added)
- Financial info: `No custodial payment data`
- Location: `No`
- Contacts: `No`
- User content: `Yes` (chat/profile/broadcast metadata)
- Browsing history: `No`
- Identifiers: `Yes` (public key identity used by protocol)
- Diagnostics: `Only if crash/analytics SDK added` (otherwise `No`)

Tracking:

- `No` (do not enable tracking declaration unless ad/tracking SDKs are added)

## 3) Google Play Data Safety (recommended baseline)

- Data shared: `No` (unless third-party sharing added)
- Data collected: `Yes` for user-provided protocol content/identifiers used for core functionality
- Data encrypted in transit: `Yes`
- Data deletion request path: provide support URL/process if required by policy scope

## 4) Reviewer-facing moderation statement

Use this in review notes:

`dStream includes in-app reporting for stream/user/message, user mute/block controls, and operator moderation on official discovery surfaces. Terms, Privacy, and Community Guidelines are linked in-app and publicly accessible.`

## 5) Screenshot set minimum

Prepare platform screenshots that show:

1. first-run node/relay setup
2. browse/discovery
3. broadcast controls
4. watch + chat
5. report modal
6. moderation/policy surfaces

## 6) Metadata consistency checks

Before submit, verify all are true:

- Listing copy matches `docs/MOBILE_STORE_LISTING_COPY.md`.
- URLs are live and return `200`:
  - `/privacy`
  - `/terms`
  - `/community-guidelines`
- Metadata does not claim custodial wallet behavior.
- Metadata does not claim centralized editorial control of decentralized network traffic.
