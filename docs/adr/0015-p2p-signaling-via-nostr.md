# ADR 0015: P2P Signaling via Nostr (WebRTC)

- Status: Accepted
- Date: 2026-02-05

## Context

Phase 3 requires peer-to-peer delivery that is as decentralized as possible.

WebRTC provides the transport primitives we want (ICE, NAT traversal, DTLS, data channels), but requires an external signaling path for offers/answers/candidates.

The rebuild explicitly avoids introducing a centralized signaling service (ADR 0012).

## Decision

### Transport

- P2P transport is **WebRTC**.
- The initial integration uses **WebRTC data channels** to exchange application data (later: HLS segment/playlist data).

### Signaling

Use **Nostr relays** for signaling (no dedicated HTTP/WebSocket signaling service).

Signaling events:

- **Kind**: `8108` (app-specific)
- **Tags**:
  - `p=<recipientPubkeyHex>` (directed message routing)
  - `a=30311:<streamPubkeyHex>:<streamId>` (stream scoping; same as chat/presence)
  - `expiration=<unixSeconds>` (optional; NIP-40 retention hint)
- **Content**: NIP-04 ciphertext containing a JSON payload (v1).

If NIP-04 encryption/decryption is unavailable for the active identity, P2P is considered **disabled** (no plaintext fallback in v1).

### Payload schema (v1)

The decrypted JSON payload is:

- `v`: `1`
- `type`: `"offer" | "answer" | "candidate" | "bye" | "ping" | "pong"`
- `sessionId`: string (random per peer connection)
- `streamPubkey`: 64-hex
- `streamId`: string
- `swarmId`: string (derived per ADR 0007; optional in v1 but recommended)
- `sdp`: string (for offer/answer)
- `candidate`: `RTCIceCandidateInit` (for candidate)

The Nostr event `pubkey` is the sender identity; the `p` tag is the recipient. The recipient uses NIP-04 with `(senderPubkey, recipientSecret)` to decrypt.

## Consequences

- No central signaling service is required; relays can be user-configured.
- Signaling privacy is improved vs plaintext offers/candidates because relay operators cannot read the payload.
- The app must maintain a local signaling key/secret for any peer that participates in P2P (viewers can use an ephemeral key even without NIP-07).
- Relay retention varies; v1 relies on encrypted payloads and optionally uses `expiration` to reduce persistence.

