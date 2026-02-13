# JRNY → dStream Parity Matrix (Full Vision Contract)

Last updated: 2026-02-12

This document exists to prevent “scope amnesia”.

It maps:

1) what the original JRNY repository describes (README / PROTOCOL / FEATURES / ARCHITECTURE / infra), to
2) what this dStream rebuild currently implements, and
3) what is missing before we can honestly call the rebuild “done” under the **everything** scope.

## Current rebuild reality (what is real today)

- Web: `http://127.0.0.1:5656`
- Automated E2E (Safari): `npm run smoke:e2e` passes (WHIP publish → HLS available → announce (kind `30311`) → chat (kind `1311`) → watch playback probe → presence (kind `30312`) → P2P datachannel + binary echo).
- Automated E2E (Firefox): `npm run smoke:e2e:firefox` passes (generates a non-loopback MediaMTX config and recreates the `mediamtx` container).
- Automated integrity smoke (Safari/Firefox): `npm run smoke:integrity` and `npm run smoke:integrity:firefox` pass (manifest verification + tamper marker signaling).
- Wallet interoperability smoke: `npm run smoke:wallet` verifies tip subaddress allocation + detection/confirmation polling (manual wallet or mock inject).
- Wallet certification matrix smoke: `npm run smoke:wallet:matrix` runs sequential external-wallet verification (`cake`, `feather`, `cli`).
- Wallet capability smoke: `npm run smoke:wallet:cap` verifies wallet RPC method profiles (`tip_v1`, `stake_v2`, `escrow_v3_multisig`).
- Real-wallet autonomous smoke: `npm run smoke:wallet:real` verifies sender→receiver transfer confirmation via real wallet RPC + regtest daemon.
- Escrow-v3 multisig smoke: `npm run smoke:escrow:v3` verifies coordinator/participant session coordination (`prepare → make → exchange → import → sign → submit`).
- Production preflight gates: `ENV_FILE=.env.production npm run harden:deploy` and `EXTERNAL_BASE_URL=<public-url> npm run smoke:external:readiness` validate deploy-critical env/bundle assumptions.
- Identity UX: user-facing pubkeys are `npub…` (NIP-19) and routes accept `npub` or hex; internal canonical pubkeys are 64-hex (ADR `0013`).
- Identity/profile/chat parity additions are shipped: multi-local key management (import/export/switch/remove), profile publish/view pages, verified/subscriber chat badges, slash commands, and encrypted stream whispers.

## Legend

- ✅ Implemented and exercised in the rebuild.
- 🟡 Partial in the rebuild (plumbing exists; the real flow is not shipped).
- ❌ Missing in the rebuild.
- ⚠️ Divergence: rebuild behavior differs materially from JRNY’s protocol/docs.

## High-level parity table (capabilities)

| Area | JRNY “source of truth” (concept) | Rebuild status | Notes / gap to “everything” |
|---|---|---:|---|
| Core loop: broadcast → announce → watch | JRNY README + FEATURES | ✅ | Core loop works end-to-end and is smoke-tested. |
| Landing page visuals (cube + animated words + icon) | JRNY home page | ✅ | Implemented and viewable at `/dev/visuals` (see `docs/VISUALS.md`). |
| Nostr identity + announce-based discovery | JRNY README | ✅ | kind `30311` announce + browse/search/shuffle are implemented. |
| Stream-scoped chat | JRNY FEATURES | ✅ | kind `1311`, scoped by `a=30311:<pubkeyHex>:<streamId>` (ADR `0009`). |
| Presence / viewer count | JRNY FEATURES | ✅ | kind `30312` presence + approximate viewer count UX (ADR `0010`). |
| WHIP ingest (browser) | JRNY README | ✅ | WHIP publish works via MediaMTX. |
| WHEP playback (WebRTC) | JRNY README | ✅ | WHEP low-latency playback is implemented (ADR `0023`) with automatic fallback to HLS. |
| P2P HLS delivery (peer assist) | JRNY README / PROTOCOL / CONFIG | ✅⚠️ | Rebuild ships Nostr-relay signaling + WebRTC datachannels (ADR `0019`), not tracker/WebTorrent signaling. |
| Integrity manifests (segment hashing + verification) | JRNY PROTOCOL (`MANIFEST_ROOT`) + manifest service | ✅ | Origin signer publishes kind `30313` (ADR `0020`); watchers verify segments + surface tamper UX (`npm run smoke:integrity`). |
| Monero tipping (user-facing) | JRNY README | ✅ | Tip address in announces + watch UI + verified tips flow (unique subaddress + status check) (ADRs `0017`, `0021`). |
| Monero wallet RPC + verification | JRNY infra compose (`monero` service) | ✅ | Server-only wallet RPC integration + verification routes exist; local compose includes a mock wallet RPC (`xmr-mock`). |
| Escrow/staking + anti-leech incentives | JRNY README / PROTOCOL | ✅⚠️ | Stake-gated P2P assist, refund/slash settlement, and escrow-v3 multisig coordination routes are implemented (ADRs `0022`, `0025`, `0027`); trust boundary is explicit (no on-chain trustless claim). |
| Trusted peers / keyring / favorites | JRNY contexts | ✅ | Implemented locally via `/settings` (aliases, trusted/muted/blocked, favorites) and wired into browse/watch/chat. |
| Inbox / DMs (NIP-04) | JRNY inbox context | ✅ | Implemented (NIP-04) with thread grouping + unread counts + send/receive (`/inbox`). |
| Guilds / curated discovery | JRNY guilds code + FEATURES | ✅ | kind `30315` guild definitions + featured streams + browse integration (`/guilds`, `/browse?guild=…`) plus relay-backed membership + role assignment events. |
| Moderation (ban/mute/roles) | JRNY FEATURES | ✅ | Relay-backed stream moderation actions + moderator role assignment are enforced in chat; local mute/block controls remain available. |
| Analytics dashboards | JRNY FEATURES | ✅ | Implemented at `/analytics` from real presence + Monero verification telemetry. |
| Local infra completeness (manifest + monero services) | JRNY infra compose | ✅ | Root compose ships web + mediamtx + local relay + manifest signer + `xmr-mock`; `docker-compose.real-wallet.yml` adds regtest `monerod` + sender/receiver wallet-rpc + wallet bootstrap flow. |

## Divergences we must lock down (ADRs)

1) **P2P discovery/signaling**
- JRNY docs: tracker-based WebTorrent-compatible swarm (`tracker_hints`; community defaults in JRNY CONFIG).
- Rebuild: Nostr-signaled WebRTC datachannels (custom kind `8108`) + peer-assisted segment cache.
- Decision: **Nostr signaling is canonical** (ADR `0019`). Tracker support is optional future work.

2) **Integrity manifest transport**
- JRNY protocol: `MANIFEST_ROOT` is signed and used for segment verification (HTTP or P2P).
- Rebuild: manifest signer publishes kind `30313` on relays (ADR `0020`); watchers verify segments and surface tamper UX (`npm run smoke:integrity`).

3) **Payments scope drift inside JRNY**
- JRNY branding says Monero-first.
- JRNY PROTOCOL/CONFIG also mention non-Monero receipt namespaces.
- Decision: **Monero-only first** for verified tipping (ADR `0021`).

4) **WHEP**
- JRNY README calls out “WHIP/WHEP native”.
- Rebuild ships WHIP (broadcast) and WHEP (playback) via MediaMTX.
- Decision: WHEP is an optional low-latency playback path with clean fallback to HLS (ADR `0023`).
