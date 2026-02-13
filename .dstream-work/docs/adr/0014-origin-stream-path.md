# ADR 0014: Origin Stream Path Derived From Stream Identity

- Status: Accepted
- Date: 2026-02-05

## Context

WHIP ingest and HLS playback need a stable, deterministic path name in the media origin (MediaMTX in dev).

If the origin path is keyed by `streamId` only, different broadcasters can collide when they choose the same `streamId` (for example: `live`, `test`, or date-based IDs). This violates the canonical stream identity model (ADR 0002), where a stream is uniquely identified by:

- `pubkey` (hex)
- `streamId` (NIP-53 / kind:30311 `d` tag)

## Decision

Derive the origin/media path from canonical stream identity:

`originStreamId = "${pubkeyHex}--${streamId}"`

Rules:

- `pubkeyHex` is the canonical internal pubkey representation: **64 lower-case hex**.
- `streamId` must be URL/path-safe: `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/`

Endpoints:

- WHIP publish: `/api/whip/${originStreamId}/whip`
- HLS playlist: `/api/hls/${originStreamId}/index.m3u8`

Client behavior:

- Announce events publish an HLS playlist URL as a **hint** (ADR 0005).
- Watch pages try the announce hint first; otherwise fall back to same-origin HLS using `originStreamId`.

## Consequences

- No origin collisions between broadcasters using the same `streamId`.
- Origin paths are computable from watch route params (after `npub → hex` normalization).
- Broadcasters must validate `streamId` before going live; invalid IDs cannot be published.

