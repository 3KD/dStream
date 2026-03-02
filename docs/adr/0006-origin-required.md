# ADR 0006: An Origin/Seed Is Required (P2P Is Optional)

- Status: Accepted
- Date: 2026-02-04

## Context

Pure P2P cannot bootstrap a live stream from zero viewers. HLS playback needs an initial seed/origin (or equivalent) to start the swarm.

## Decision

The MVP assumes a reachable **HTTP origin** exists for HLS playlists/segments.

P2P (Phase 2) is a cost-reduction and resilience layer, not a replacement for having at least one seed.

## Consequences

- “Ownerless” is defined as *replaceable infrastructure + non-authoritative hints*, not “no servers exist”.
- Deployment docs/config must explicitly model the origin(s).

