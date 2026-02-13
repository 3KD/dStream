# ADR 0009: Chat Uses Nostr Kind:1311 Scoped to the Stream

- Status: Accepted
- Date: 2026-02-04

## Context

Chat must be decentralized, stream-scoped, and consistent across clients without requiring a central relay server.

## Decision

Use Nostr kind `1311` for stream chat with scope defined by:

- `a = "30311:${pubkey}:${streamId}"`

Moderation, roles, whispers, and inbox/DMs are Phase 2+.

## Consequences

- Simple implementation that aligns with discovery identity.
- Future features must remain compatible with the scoping scheme.

