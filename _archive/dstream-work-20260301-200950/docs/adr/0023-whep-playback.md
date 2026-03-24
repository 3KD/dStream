# ADR 0023: WHEP Playback (Low Latency WebRTC)

- Status: Accepted
- Date: 2026-02-06

## Context

JRNY’s README states “WHIP/WHEP native”. The rebuild currently supports:

- WHIP (broadcast ingest) via MediaMTX
- HLS (playback) via MediaMTX

We need a real WHEP playback option to reduce latency and to match the stated capability set.

## Decision

### 1) WHEP is an optional playback path

Watchers can play via:

- WHEP (preferred when available/configured)
- HLS fallback (always available when origin is live)

### 2) Routing and origin mapping

WHEP follows the same origin stream identity rules as WHIP/HLS:

- `originStreamId = "${pubkeyHex}--${streamId}"` (ADR 0014)
- WHEP endpoint path: `/${originStreamId}/whep`

The web app exposes a server-side proxy route:

- `/api/whep/${originStreamId}/whep` → origin WHEP

### 3) UX gating (no placeholder)

- The UI must not show “Low latency (WHEP)” unless:
  - a WHEP origin is configured, and
  - negotiation succeeds for the current stream.
- If negotiation fails, the player must fall back to HLS automatically and surface a non-alarming note (“low-latency unavailable”).

### 4) ICE server configuration

WHEP uses the same ICE server configuration as P2P:

- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` (comma-separated or JSON array)

## Consequences

- We must implement a WHEP client in the watch player that:
  - negotiates SDP via POST (WHEP)
  - supports trickle ICE if required by the origin
  - attaches the remote media stream to a `<video>` element
- We must add tests that:
  - cover negotiation/fallback logic (mocked origin is allowed)

