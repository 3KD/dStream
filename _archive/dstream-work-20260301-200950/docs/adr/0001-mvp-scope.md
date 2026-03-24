# ADR 0001: MVP Scope (Nostr Streaming Core Loop)

- Status: Deprecated (superseded by ADR 0016)
- Date: 2026-02-04

## Context

The current codebase demonstrates many ideas (P2P HLS, integrity, escrow, chat, discovery), but mixing “core loop” and “future” features creates drift and slows iteration.

## Decision

Define the MVP as a Nostr-native live streaming product with only the following required loop:

1. **Go Live**: WHIP ingest from the broadcaster.
2. **Announce/Discover**: Nostr-based stream metadata + status.
3. **Watch**: HLS playback with robust fallback.
4. **Chat**: Nostr chat scoped to the stream.

Explicitly **out of MVP** (Phase 2+): P2P delivery, Monero escrow/tipping verification, and integrity signing/verification.

## Consequences

- The rebuild repo can ship a coherent v0 faster.
- “Phase 2” features must have clean seams, but do not block MVP quality.
