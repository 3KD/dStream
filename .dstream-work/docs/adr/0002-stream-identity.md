# ADR 0002: Canonical Stream Identity

- Status: Accepted
- Date: 2026-02-04

## Context

Ambiguity between “channel”, pubkey, stream id, and route params leads to incorrect lookups and inconsistent linking.

## Decision

A stream is uniquely identified by:

- `broadcasterPubkey` (Nostr pubkey, hex)
- `streamId` (the NIP-53 / kind:30311 `d` tag value)

The canonical internal unique key is:

- `streamKey = "${broadcasterPubkey}:${streamId}"`

## Consequences

- All UI links, caches, and in-memory maps use `streamKey`.
- Any “single string identifier” passed around must be explicit whether it is `pubkey`, `streamId`, or `streamKey`.

