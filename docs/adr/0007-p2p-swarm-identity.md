# ADR 0007: P2P Swarm Identity Is Origin-Independent (Phase 2)

- Status: Accepted
- Date: 2026-02-04

## Context

Using the playlist URL as a swarm ID makes the swarm unstable across mirrors, proxies, and fallback origins.

## Decision

When implementing P2P:

- Derive swarm identity from stable stream identity, not from URLs.
- Default derivation: `swarmId = hash("${pubkey}:${streamId}:${rendition}")` (exact hash function chosen in the protocol module).

## Consequences

- Swarms persist across origin changes, which improves resilience.
- Requires the player/P2P integration to be driven by stream identity, not by `src` strings.

