# ADR 0016: Scope v2 (Full Vision: Integrity + Monero)

- Status: Accepted
- Date: 2026-02-06

**Note:** Deprecated (superseded by ADR 0018 “JRNY Parity / Everything”).

## Context

ADR 0001 intentionally narrowed scope to a “core loop” MVP (WHIP → announce → watch → chat) to avoid drift and get a working rebuild scaffold shipped.

That produced a stable skeleton (tests + docs + UI), but it **does not match the project’s stated product vision** in the JRNY repository and branding:

- Monero-native monetization (tips + staking/escrow)
- Integrity signing/verification for segments
- P2P delivery as a real distribution path (not just a demo)

We are now ready to expand scope without reintroducing “stub UI” or “future feature” drift.

## Decision

The project’s definition of “completed” is upgraded from “MVP core loop” to the **full dStream vision**:

1. **Streaming core loop** (keep): broadcast via WHIP, announce/discover on Nostr, watch via HLS, stream-scoped chat.
2. **Integrity** (add): segment hashing + signed manifest publishing + viewer verification + tamper UX.
3. **Monero** (add): Monero tipping + staking/escrow mechanisms that are real and testable.
4. **P2P delivery** (keep/strengthen): peer assist becomes a real path with honest UX and measurable behavior.

This supersedes the “Explicitly out of MVP” list in ADR 0001.

## Consequences

- We must update `docs/FEATURE_FREEZE.md` and `docs/ROADMAP.md` to reflect the new “done” bar.
- Any Monero / integrity / P2P UI must be backed by real behavior (no “Coming soon”).
- We will add ADRs that define:
  - how integrity manifests are represented (Nostr kinds + schema),
  - how Monero tips/stakes are represented and verified (wallet RPC model + Nostr event schema),
  - how P2P incentives relate (or do not relate) to staking/escrow.
