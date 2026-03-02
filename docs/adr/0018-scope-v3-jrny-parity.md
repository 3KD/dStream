# ADR 0018: Scope v3 (JRNY Parity / “Everything”)

- Status: Accepted
- Date: 2026-02-06

## Context

The rebuild shipped a working skeleton (core loop + tests), but it’s still easy to “forget” major parts of the original project vision that exist in JRNY’s docs, branding, and legacy code:

- Monero-native monetization (tips + verified receipts)
- Escrow/staking + incentives (anti-leech)
- Integrity manifests (segment hashing + signing + verification)
- WHEP (WebRTC playback) as a first-class capability
- Richer identity/discovery features (trusted peers, keyring, favorites, guilds, inbox/DMs, moderation, analytics)

We need an explicit decision record that says: **the goal is JRNY parity**, not an MVP subset.

## Decision

“Completed” for this rebuild means **parity with the JRNY vision** as captured by:

- JRNY repo documentation (README / PROTOCOL / FEATURES / ARCHITECTURE / infra)
- This repo’s parity map: `docs/JRNY_PARITY.md`

Concretely, the rebuild must include (no placeholders):

1) **Streaming core loop** (already shipped):
   - broadcast via WHIP
   - announce/discover on Nostr
   - watch via HLS
   - stream-scoped chat
2) **P2P delivery**:
   - peer-assisted segment delivery is a real, measurable path
   - the chosen swarm discovery model (trackers vs Nostr signaling vs both) is documented and tested
3) **Integrity**:
   - segment hashing on the origin side
   - signed manifest publishing
   - viewer-side verification + tamper UX
4) **Monero economy**:
   - user-facing tip/stake addresses
   - verified tip/stake detection via wallet RPC model
   - receipts (optional) via Nostr event schema
5) **Escrow/staking + incentives**:
   - stake rules + verification + refund/slash model (honest UX)
6) **WHEP playback**:
   - a low-latency WebRTC playback path exists (when origin supports it)
7) **Identity + social/discovery modules**:
   - trusted peers + keyring aliases + favorites
   - inbox/DMs (NIP-04)
   - guilds / curated discovery primitives
   - moderation tooling
   - analytics surfaces built on real telemetry

This ADR supersedes ADR 0016 (Scope v2). ADR 0016 remains historically accurate but is no longer sufficient as the “done” contract.

## Consequences

- Update `docs/FEATURE_FREEZE.md`, `docs/ROADMAP.md`, and `docs/STATUS.md` so they cannot omit JRNY parity items again.
- Add focused ADRs to specify the missing protocol/schema details:
  - integrity manifest kind/schema + epoching rules
  - Monero receipt schema + wallet RPC verification model
  - escrow/stake rules + evidence model
  - WHEP endpoint + fallback/UX rules
  - P2P swarm discovery model (trackers/Nostr/both) + security/abuse considerations
- Maintain the “no placeholder UI” rule: unfinished features must be hidden until backed by real behavior.

