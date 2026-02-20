# JRNY → dStream Parity Matrix (Full Vision Contract)

Last updated: 2026-02-06

This document is the “no surprises” map from **what JRNY describes/contains** → **what the dStream rebuild actually implements** (in `/Users/erik/Projects/dStream`) → **what is missing** before we can honestly say “done” under the *everything* scope.

## Current dStream rebuild (what is real today)

- Web: `http://127.0.0.1:5656`
- Automated E2E: `/Users/erik/Projects/dStream` `npm run smoke:e2e` passes (WHIP publish → HLS available → announce (kind `30311`) → chat (kind `1311`) → watch playback probe → presence (kind `30312`) → P2P datachannel + binary echo).
- Identity UX: user-facing pubkeys are `npub…` (NIP-19) and routes accept `npub` or hex; internal canonical pubkeys are 64-hex (see `/Users/erik/Projects/dStream/docs/adr/0013-npub-user-facing.md`).

## Legend

- ✅ Implemented and exercised in dStream (rebuild).
- 🟡 Partial in dStream (plumbing exists; the real flow is not shipped).
- ❌ Missing in dStream.
- ⚠️ Divergence: dStream implementation materially differs from JRNY’s protocol/docs.

JRNY “implemented vs described” is called out in the notes per area, because JRNY contains both real code and conceptual stubs/placeholders.

## High-level parity table (capabilities)

| Area | JRNY “source of truth” | dStream rebuild status | Notes / gap to “everything” |
|---|---|---:|---|
| Core loop: broadcast → announce → watch | `/Users/erik/Projects/JRNY/README.md`, `/Users/erik/Projects/JRNY/FEATURES.md` | ✅ | dStream core loop works end-to-end and is smoke-tested. |
| Landing page visuals (cube + animated words + icon) | `/Users/erik/Projects/JRNY/apps/web/app/page.tsx` | ✅ | Implemented in dStream (`/Users/erik/Projects/dStream/apps/web/src/components/landing/RotatingCube.tsx`) and viewable at `/dev/visuals`. |
| Nostr identity + announce-based discovery | `/Users/erik/Projects/JRNY/README.md`, `/Users/erik/Projects/JRNY/FEATURES.md` | ✅ | dStream publishes/consumes stream announces (kind `30311`). |
| Stream-scoped chat | `/Users/erik/Projects/JRNY/FEATURES.md` | ✅ | dStream kind `1311` scoped by `a=30311:<pubkeyHex>:<streamId>` (see `/Users/erik/Projects/dStream/docs/adr/0009-chat-scope.md`). |
| Presence / viewer count | `/Users/erik/Projects/JRNY/FEATURES.md` (legacy) | ✅ | dStream implements presence (kind `30312`) + approximate viewer count UX (ADR `0010`). |
| Browser broadcast studio (camera/screen + device dropdowns) | `/Users/erik/Projects/JRNY/FEATURES.md` | ✅ | dStream `/broadcast` has camera/screen preview + mic/camera selectors. |
| WHIP ingest (browser) | `/Users/erik/Projects/JRNY/README.md` | ✅ | dStream broadcasts via WHIP to MediaMTX. |
| WHEP playback (WebRTC) | `/Users/erik/Projects/JRNY/README.md` | ❌ | Not implemented in dStream. Only HLS playback exists. Requires ADR + implementation + tests. |
| P2P HLS delivery (peer assist) | `/Users/erik/Projects/JRNY/README.md`, `/Users/erik/Projects/JRNY/PROTOCOL.md`, `/Users/erik/Projects/JRNY/CONFIG.md` | ✅⚠️ | dStream has real peer assist **but diverges** from JRNY’s tracker/WebTorrent model (see “Divergences” below). |
| Integrity manifests (segment hashing + verification) | `/Users/erik/Projects/JRNY/PROTOCOL.md` (`MANIFEST_ROOT`), `/Users/erik/Projects/JRNY/services/manifest/` | ❌ | Not implemented in dStream. JRNY has a partial manifest service (HTTP endpoint + `manifest.json`) but not the full Nostr-published verification flow. |
| Monero tipping (user-facing) | `/Users/erik/Projects/JRNY/README.md`, `/Users/erik/Projects/JRNY/apps/web/src/components/wallet/MoneroManager.tsx` | 🟡 | dStream supports `["xmr","<address>"]` in announces + watch UI panel (ADR `0017`), but **no wallet RPC / verification / receipts** yet. |
| Monero wallet RPC + verification | `/Users/erik/Projects/JRNY/infra/stream/docker-compose.yml` (`monero` service) | ❌ | Not in dStream compose; no backend verification logic exists. |
| Escrow/staking + anti-leech incentives | `/Users/erik/Projects/JRNY/README.md`, `/Users/erik/Projects/JRNY/PROTOCOL.md` | ❌ | Not implemented in dStream. Needs explicit ADRs (rules + evidence + verification). |
| Trusted peers / keyring / favorites | `/Users/erik/Projects/JRNY/apps/web/src/context/*` | ❌ | dStream only has `/Users/erik/Projects/dStream/apps/web/src/context/IdentityContext.tsx`. |
| Inbox / DMs (NIP-04) | `/Users/erik/Projects/JRNY/apps/web/src/context/InboxContext.tsx` | ❌ | Missing in dStream. |
| Guilds / curated discovery layer | `/Users/erik/Projects/JRNY/apps/web/app/page.tsx`, `/Users/erik/Projects/JRNY/FEATURES.md` | ❌ | Missing in dStream. |
| Moderation (ban/mute/roles) | `/Users/erik/Projects/JRNY/FEATURES.md` | ❌ | Missing in dStream. |
| Analytics dashboards | `/Users/erik/Projects/JRNY/FEATURES.md` | ❌ | Missing in dStream. |
| Local infra completeness (manifest + monero containers) | `/Users/erik/Projects/JRNY/infra/stream/docker-compose.yml` | ❌ | dStream compose currently ships: web + mediamtx + local relay (no manifest service, no monero). |

## Major divergences (JRNY protocol/docs vs dStream rebuild)

These are the “drift vs conceptually sound” items we need to decide and lock down in ADRs before deep implementation.

1) **P2P discovery/signaling**
- JRNY docs: tracker-based, WebTorrent-compatible swarm signaling (`tracker_hints`, `CONFIG.md` tracker defaults). See `/Users/erik/Projects/JRNY/PROTOCOL.md` + `/Users/erik/Projects/JRNY/CONFIG.md`.
- dStream rebuild: Nostr-signaled WebRTC datachannels (custom kind `8108`) + peer-assisted segment cache.
- Status: **both are decentralized**, but they are not the same network model. We must decide:
  - **A. Align to trackers (p2p-media-loader / WebTorrent)** to match JRNY docs, or
  - **B. Keep Nostr-signaled WebRTC** as the canonical P2P path, or
  - **C. Support both** (harder; needs clear precedence + UX).

2) **Integrity manifest transport**
- JRNY protocol: `MANIFEST_ROOT` is a signed structure that viewers verify against downloaded segments (HTTP or P2P). See `/Users/erik/Projects/JRNY/PROTOCOL.md`.
- JRNY code: `/Users/erik/Projects/JRNY/services/manifest/` generates a local `manifest.json` per stream dir and exposes `/manifest` over HTTP (no Nostr publishing).
- dStream rebuild: no manifests yet.
- Decision required: where do manifests live (Nostr events, HTTP endpoint, both), what kind/schema, and what verification UX is mandatory.

3) **Payments scope drift inside JRNY itself**
- JRNY README/branding: “Monero-native monetization”, “Monero staking & tipping”.
- JRNY protocol/config: `TIP_RECEIPT` examples mention non-Monero namespaces (`eip155`, etc) and `/Users/erik/Projects/JRNY/CONFIG.md` lists EVM/Solana/BTC namespaces.
- Decision required: for “everything v1”, do we implement **Monero-only first** (recommended for focus), then add other chains later, or must multi-chain tipping be in v1?

4) **WHEP**
- JRNY README calls out “WHIP/WHEP native”.
- dStream rebuild currently ships WHIP (broadcast) but not WHEP (playback).
- Decision required: is WHEP required for v1 “everything”, or a v2 milestone after integrity + Monero?

## “What’s missing” (the concrete port list)

This is the shortest actionable list of major JRNY modules that do not exist in the dStream rebuild:

**UI pages**
- JRNY: `/Users/erik/Projects/JRNY/apps/web/app/docs/` and `/Users/erik/Projects/JRNY/apps/web/app/search/` exist.
- dStream: no `/docs` page, no `/search` page (only inline search on homepage + `/browse`).

**Contexts / user features**
- JRNY: `/Users/erik/Projects/JRNY/apps/web/src/context/` includes:
  - `TrustedPeersContext` (trust/ban lists)
  - `KeyringContext` (aliases)
  - `FavoritesContext` (favorites)
  - `InboxContext` (NIP-04 DM inbox)
  - `SettingsContext` (player + Monero RPC settings)
  - `TipContext` (tip alerts + configured XMR address)
- dStream: only `IdentityContext` exists.

**Services / infra**
- JRNY: `/Users/erik/Projects/JRNY/services/manifest/` (segment hashing + signature) and `/Users/erik/Projects/JRNY/infra/stream/docker-compose.yml` includes `manifest` and `monero` services.
- dStream: `docker-compose.yml` does not include `manifest` or `monero`.

## Next step (what I’m going to do next)

1) Convert the divergence list above into explicit ADRs (so “everything” is unambiguous).
2) Update the dStream feature freeze + roadmap so it cannot omit Monero/wallets/escrow/integrity/WHEP/tracker-P2P/etc again.
3) Only then start implementation in dependency order (infra/services → protocol → UI), with **no placeholder UI**: unfinished features are hidden until real.

