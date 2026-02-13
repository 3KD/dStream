# ADR 0010: Presence/Viewer Count Is Approximate and Non-Trustless

- Status: Accepted
- Date: 2026-02-04

## Context

Counting viewers in a decentralized system is easy to game and depends on relay behavior. Treating it as authoritative invites abuse.

## Decision

Presence/viewer count is:

- Best-effort, approximate, and treated as UX-only.
- Optional and may be disabled by default.
- Potentially filtered (e.g., “trusted keys only”) depending on the product mode.

### Implementation (v1)

- Presence events use kind `30312`.
- Scope is the stream identity via:
  - `a = "30311:<broadcasterPubkeyHex>:<streamId>"`
- Viewers are counted as unique authors with a presence event in a recent rolling window (default: ~90s).

## Consequences

- Avoids building product-critical logic on unverifiable signals.
- “Viewer count” should be labeled accordingly in UI.
