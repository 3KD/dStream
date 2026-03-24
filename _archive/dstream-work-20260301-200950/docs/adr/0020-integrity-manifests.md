# ADR 0020: Integrity Manifests (Segment Hashing + Verification)

- Status: Accepted
- Date: 2026-02-06

## Context

JRNY’s protocol documents require integrity verification:

- segments must be hash-verified regardless of delivery path (origin HTTP or P2P)
- viewers must detect tampering and fall back to alternative sources

The rebuild currently does not publish any integrity data. This ADR defines the *minimal complete* integrity protocol that can be implemented and tested.

## Decision

### 1) Manifest events are Nostr events

Integrity manifests are published as **Nostr parameterized replaceable events**:

- **kind:** `30313`
- **signer:** a *manifest signer pubkey* (see below)
- **scoping:** manifests are scoped to the stream via `a=30311:<streamPubkeyHex>:<streamId>`

### 2) Manifest signer is explicit

Because broadcasters may use NIP-07 (no server-side private key), integrity signing is performed by a dedicated **manifest signer key**.

Stream announces (kind `30311`) MUST include:

- `["manifest", "<manifestSignerPubkeyHex>"]`

Viewers MUST only accept manifest events for a stream if:

- the manifest event’s `pubkey` equals the announced `manifestSignerPubkeyHex`, and
- the manifest event includes the correct `a` tag.

If the announce does not include a manifest signer, viewers must not show integrity UI.

### 3) Epoching model

Manifests are published per epoch window:

- `epochDurationMs` default: `12_000` (configurable)
- each manifest covers a contiguous set of segment URIs within that epoch
- manifests MAY be republished/updated for the same epoch (parameterized replaceable)

### 4) Event tags

Manifest events MUST include:

- `["d", "<streamPubkeyHex>:<streamId>:<renditionId>:<epochStartMs>"]` (parameterized key)
- `["a", "30311:<streamPubkeyHex>:<streamId>"]` (stream scope)
- `["r", "<renditionId>"]` (rendition identifier; e.g. `video1`)
- `["epoch", "<epochStartMs>", "<epochDurationMs>"]`

### 5) Content schema (JSON)

Manifest event `content` is JSON:

```json
{
  "v": 1,
  "streamPubkey": "<hex>",
  "streamId": "<string>",
  "renditionId": "video1",
  "epochStartMs": 1700000010000,
  "epochDurationMs": 12000,
  "segments": [
    { "uri": "seg_001.m4s", "sha256": "<hex>", "byteLength": 12345 }
  ],
  "init": { "uri": "init.mp4", "sha256": "<hex>", "byteLength": 12345 }
}
```

Rules:

- `sha256` is SHA-256 over the raw segment bytes.
- `uri` is the playlist-relative segment URI (the exact string the playlist references).
- `byteLength` is optional but recommended.

### 6) Verification rules (viewer)

For every segment fetched:

1) find a manifest entry matching the segment `uri` for the current epoch window
2) compute SHA-256 of the fetched bytes
3) compare to the manifest `sha256`
4) on mismatch:
   - discard the segment bytes (do not pass to the decoder)
   - mark the source as “bad” (peer penalty if P2P)
   - retry via origin HTTP or another peer if available
   - surface a clear tamper indicator in UX

### 7) Source independence

The same verification path applies whether the segment arrives from:

- origin HTTP (`/api/hls/...`)
- P2P datachannel exchange

## Consequences

- We must implement:
  - origin-side hashing + manifest publishing (service/container)
  - viewer-side verification (player loader hook) + honest UX
- We must add tests:
  - schema validation tests (protocol package)
  - an integration test that proves a tampered segment is rejected

