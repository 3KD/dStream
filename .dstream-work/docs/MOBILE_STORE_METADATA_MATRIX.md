# Mobile Store Metadata Matrix (iOS + Android)

Last updated: 2026-10-03

Purpose: keep App Store Connect and Google Play metadata aligned with shipped behavior.

**Submission worksheet, not authoritative answers:** Data collection/sharing declarations are legal and platform-facing representations. Rebuild them against the exact signed artifact, privacy policy, server logs, SDK inventory, relay traffic, and payment flows before submission. The examples below are prompts, not pre-approved values.

## 1) Content rating targets

Use conservative defaults unless your moderation policy requires stricter categories.

- iOS age rating: `17+` (recommended for open UGC live chat/video)
- Google Play content rating: complete IARC questionnaire as UGC/social app

## 2) iOS App Privacy evidence review

For each category, record whether the exact artifact transmits data to the selected node, Nostr relays, payment providers, or analytics/crash services. Do not equate noncustodial operation with no data collection.

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

## 3) Google Play Data Safety evidence review

- Determine whether relay publication, node processing, wallet-provider handoff, and any bundled SDK count as collection or sharing under the current Play definitions.
- Verify transport encryption for every production endpoint before answering the encryption question.
- Verify the actual deletion/request process and its limits for relay-published data.
- Preserve the evidence and date used for every answer.

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
