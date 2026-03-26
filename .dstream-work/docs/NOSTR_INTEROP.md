# Nostr Interoperability & Event Kind Registry

Last updated: 2026-03-26

## Standard NIP-53 Compliance

dStream uses NIP-53 (Live Activities) as the foundation for livestreaming on Nostr.

| Kind | dStream Usage | NIP-53 Definition | Status |
|------|--------------|-------------------|--------|
| **30311** | Stream announce (live/ended, metadata, payment info) | "Live Event" | **Aligned** — fully interoperable with zap.stream, Nostrudel, etc. |
| **1311** | Stream chat messages scoped by `a` tag | "Live Chat Message" | **Aligned** — cross-client chat works |

These two kinds are the public interface. Any NIP-53 client can discover dStream broadcasts and participate in chat.

## Kind Clashes (must fix)

| Kind | dStream Usage | NIP-53 Definition | Action Required |
|------|--------------|-------------------|-----------------|
| **30312** | Viewer presence (heartbeat) | "Meeting Space Event" (space config) | **CLASH.** NIP-53 uses **10312** for presence. dStream should migrate to 10312 or a custom kind. |
| **30313** | Manifest root (integrity signing) | "Meeting Room Events" (scheduled meetings) | **CLASH.** dStream should move to an unused kind. |

## Custom Event Kinds (unregistered)

These kinds are used internally by dStream and are not defined by any NIP. They are in the 30000–40000 addressable event range which is actively used by new NIPs — consider migrating to a higher range (e.g. 39000+) or submitting a NIP proposal.

| Kind | Purpose | Collision Risk |
|------|---------|---------------|
| **8108** | P2P WebRTC signaling (SDP offer/answer/candidate/bye, encrypted via NIP-04) | Low — ephemeral event range, no known NIP claims this |
| **30314** | Monero tip receipt (amount, tx confirmation) | Medium — in active addressable range |
| **30315** | Guild definition (community/group profile) | Medium |
| **30316** | P2P bytes receipt (bandwidth contribution proof) | Medium |
| **30317** | Stream moderation action (mute/ban/clear) | Medium |
| **30318** | Stream moderator/subscriber role assignment | Medium |
| **30319** | Guild membership (join/leave) | Medium |
| **30320** | Guild role assignment (member/mod/admin) | Medium |
| **30321** | App-level discovery moderation (hide/show streams) | Medium |

## NIPs Used

| NIP | Usage |
|-----|-------|
| NIP-01 | Basic protocol (event structure, relay communication, filters) |
| NIP-04 | Encrypted DMs (inbox) and P2P signal encryption |
| NIP-07 | Browser extension signing (Alby, nos2x, etc.) |
| NIP-19 | bech32 encoding (npub in URLs and UI, nsec for key export) |
| NIP-53 | Live activities (stream announces, chat) |
| NIP-98 | HTTP auth (signed event proofs for API access control) |

## Interoperability with Existing Nostr Clients

**What works today:**
- dStream streams appear in any NIP-53 client (zap.stream, Nostrudel, Amethyst, etc.)
- Chat messages sent from other clients appear in dStream and vice versa
- User profiles (kind 0) are shared across the Nostr ecosystem
- Follows/social graph (kind 3) is read by dStream for discovery

**What doesn't cross over:**
- P2P delivery (kind 8108 signaling) is dStream-specific
- Payment receipts (kind 30314) are dStream-specific
- Guilds, moderation roles, and discovery mod events are dStream-specific
- Manifest integrity (kind 30313) is dStream-specific

## Recommended Migration Plan

1. **30312 → 10312** for presence (aligns with NIP-53 presence spec)
2. **30313 → 39313** for manifest root (moves out of NIP-53 collision range)
3. **30314–30321 → 39314–39321** for all custom kinds (reduces future collision risk)
4. **8108** — keep as-is (ephemeral range, low collision risk)
5. Submit a NIP proposal for dStream's custom kinds if adoption grows

## Related Projects

- [zap.stream](https://github.com/v0l/zap.stream) — NIP-53 livestreaming client (Lightning zaps)
- [zap-stream-core](https://github.com/v0l/zap-stream-core) — zap.stream backend (Docker)
- [nostr-embed](https://github.com/nostrband/nostr-embed) — embed Nostr notes on websites (no video)
- [Nostr.Band embed](https://embed.nostr.band/) — note/profile embed widget
- [NDK](https://github.com/nostr-dev-kit/ndk) — higher-level Nostr dev kit
- [Osty](https://github.com/nicli/osty) — Next.js-like framework for Nostr apps
- [AlgoRelay](https://github.com/bitvora/algorelay) — algorithmic Nostr relay (personalized feeds)
