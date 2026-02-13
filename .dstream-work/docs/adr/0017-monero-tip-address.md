# ADR 0017: Monero Tip Address in Stream Announce

- Status: Accepted
- Date: 2026-02-06

## Context

The “full vision” scope includes Monero-native monetization, and the product’s branding expects Monero to be a first-class citizen.

We need a minimal, interoperable way for watchers to discover how to tip a streamer **without** introducing a centralized payments service.

## Decision

Stream announce events (kind `30311`) MAY include a Monero address via a single tag:

- `["xmr", "<address>"]`

Rules:

- The value is a plain string Monero address (no validation beyond non-empty in v1).
- If present, watch pages render a “Monero” support panel with a copy-to-clipboard action.
- If absent, no Monero UI is shown (no placeholder panels).

This tag is intentionally “dumb plumbing” and does not imply verification. Verified tips / receipts / escrow flows will be defined in follow-up ADRs.

## Consequences

- Broadcast UI includes an optional “Monero tip address” field that is persisted in the draft and included in announces when set.
- Protocol parsing exposes `announce.xmr` for downstream UI.
- Future ADRs can extend monetization without breaking this simple baseline.
