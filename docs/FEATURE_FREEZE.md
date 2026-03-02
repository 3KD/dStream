# Feature Freeze v3 (Definition of “Completed”)

Date: 2026-02-10

This document freezes the feature set for the dStream rebuild so we can drive the project to a true “completed” state.

## What “Completed” Means

The project is “completed” when all **frozen** features below are:

1. **Implemented end-to-end** (no dead code paths, no “TODO” wiring, no UI that isn’t backed by real behavior).
2. **Tested** (see “Test bar” below).
3. **No placeholder UI text** in user-facing surfaces (no “Coming soon”, “Phase 2”, “Future work”, etc.).
4. **Documented** (ADRs + user/deploy docs reflect reality).

## What’s Frozen

### Source of truth

The frozen set is defined by:

- Accepted ADRs in `docs/adr/` as of **2026-02-10** (currently `0001`–`0027`)
- This repo’s JRNY parity contract: `docs/JRNY_PARITY.md`
- The product surfaces that exist in `apps/web/app/` as of **2026-02-06**
- The rebuild RTM (requirement → ADR → phase → code → tests): `docs/TRACEABILITY_MATRIX.md`

Anything not covered by the above is **out of scope** for v1 unless we explicitly add it via an ADR + an updated freeze doc.

### In-scope product features

**Identity**
- NIP-07: connect public key + sign events in browser.
- Local dev identity: generate keypair for testing (clearly labeled as dev).
- User-facing pubkeys are `npub…`; internal pubkeys are 64-hex (ADR 0013).

**Stream identity & routing**
- Canonical stream identity: `(pubkeyHex, streamId)` and `streamKey = "${pubkeyHex}:${streamId}"` (ADR 0002).
- Watch route encodes identity: `/watch/:npub/:streamId` (accepts hex as input) (ADR 0003 + ADR 0013).
- Origin path derived from identity: `originStreamId = "${pubkeyHex}--${streamId}"` (ADR 0014).

**Broadcast (MVP)**
- Camera/mic preview, device selection.
- WHIP publish to origin.
- Announce live/ended (kind `30311`) with metadata: title, summary, image, topics, streaming hint.
- “Update announce” while live + periodic heartbeat (hardening).
- “Copy watch link” and a clear “watch/share” flow.
- Broadcaster can chat in-stream (same scoping as watch).

**Watch (MVP)**
- HLS playback with robust fallback:
  - If announce contains a valid `streaming` hint, try it.
  - Otherwise fall back to same-origin HLS using derived `originStreamId`.
- Stream-scoped chat (kind `1311`, scoped by `a=30311:<pubkeyHex>:<streamId>`) (ADR 0009).

**Discovery (MVP)**
- Browse live streams from configured relays (kind `30311`, status `live`).
- Search + shuffle.

**Media/origin model**
- Streaming URL is a hint, not authority (ADR 0005).
- Origin/seed is required for bootstrapping (ADR 0006).
- No central registry service required for discovery (ADR 0012).

**Phase 2+ features already defined by ADRs (must become real by end)**
- Presence/viewer count (approximate, UX-only) (ADR 0010).
- P2P swarm identity derived from stream identity (ADR 0007).
- P2P UX gating: only show P2P UI when truly active (ADR 0008).

**WHEP (WebRTC playback)**
- A real WHEP playback path exists (low-latency option), with a clear user-facing fallback to HLS when unavailable.
- WHEP must not introduce placeholder UI; the toggle/path is hidden unless configured and working.
- (ADR `0023`)

**Dashboard UX (A)**
- A real dashboard UI exists only once the underlying telemetry is real (no stub panels).
- The “dashboard” is a product shell over real broadcaster state, presence, and (later) P2P stats.

**Integrity (v2)**
- A signed manifest stream exists for the broadcast:
  - segment hashing on the origin side
  - manifest publishing to Nostr (ADR `0020`)
- Watchers verify segments against manifests:
  - tamper is detected and surfaced honestly in the UI
  - segment verification applies to both origin HTTP and P2P sources

**Payments (Monero) (v2)**
- Broadcasters can configure a Monero payout model (ADR `0017` + `0021` + `0022`).
- Watchers can:
  - see a Monero tip/stake address for the stream,
  - complete a tip/stake flow using their own wallet,
  - optionally publish a Nostr receipt event (ADR `0021`, kind `30314`).
- Broadcasters can verify incoming tips/stakes (wallet RPC model; ADR `0021` + `0022`).
- Stake settlement exists as real product behavior:
  - viewer refund request route (receipt-aware),
  - broadcaster slash route after configured age window,
  - documented trust model (origin-enforced; not on-chain trustless) (ADR `0025`).
- Escrow-v3 multisig coordination exists as real product behavior:
  - coordinator/participant multisig session routes,
  - `make/exchange/import/sign/submit` workflow,
  - explicit trust boundary remains non-contractual (ADRs `0026`, `0027`).

**Identity + social/discovery (JRNY parity)**
- Trusted peers + ban lists (local and/or Nostr-synced as defined by ADR).
- Keyring aliases (nickname-by-pubkey).
- Favorites (streams and/or creators) and related discovery filters.
- Inbox/DMs (NIP-04) with unread counts and thread grouping.
- Guilds / curated discovery primitives.
- Moderation tooling (at minimum: ban/mute lists + broadcaster controls for their stream chat).
- Analytics surfaces built on real telemetry (no mocked charts).

### Out of scope (for v1 freeze)

- Any feature not covered by accepted ADRs and `docs/JRNY_PARITY.md`.
- Any “Phase 2/3” teaser UI that isn’t backed by real behavior (must be removed or hidden until implemented).

## Test bar (Frozen Requirement)

Every frozen feature must have *at least one* meaningful test:

- **Protocol**: unit tests for event builders/parsers and validation.
- **Core loop**: automated end-to-end smoke test (WHIP → HLS → announce → chat) remains green.
- **Critical UX**: at least one automated browser flow test for:
  - broadcast → go live → watch playback
  - chat send/receive in the scoped stream

- **Integrity (v2)**:
  - unit tests for manifest schema validation
  - at least one integration test that proves a tampered segment is detected

- **Monero (v2)**:
  - unit tests for address parsing + receipt schema
  - integration test for wallet RPC verification logic (can use a local mocked RPC in CI)

- **WHEP**:
  - at least one automated test that exercises WHEP negotiation/fallback logic (mocked origin is allowed)

- **Identity + social/discovery**:
  - unit tests for storage + event scoping (where applicable)
  - at least one integration test for inbox (decrypt + thread grouping) if shipped

## Change control

If we want to add or expand features:

1) Write/accept an ADR, then
2) Update this freeze doc to v2 with explicit scope changes.
