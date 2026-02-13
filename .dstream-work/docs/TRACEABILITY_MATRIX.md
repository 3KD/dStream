# dStream Rebuild — Requirements Traceability Matrix (RTM)

Last updated: 2026-02-12

This RTM exists so we don’t repeat “we thought it was done / we thought it was planned”.

It answers, for each requirement:

- **What** is required (feature/behavior)
- **Why** it exists (JRNY source + ADR decision)
- **Where** it lives in the rebuild (code/infra)
- **How** we prove it works (tests)
- **When** it lands (phase in `docs/ROADMAP.md`)

## Status legend

- ✅ Implemented + exercised (tests or smoke).
- 🟡 Partial (plumbing exists; end-to-end flow not shipped).
- ❌ Missing.
- ⚠️ Divergence (we intentionally chose a different approach than JRNY docs/code).

## A) Frozen “ship” epics (top-level contract)

These are the *non-negotiables* implied by `docs/FEATURE_FREEZE.md` and `docs/JRNY_PARITY.md`.

| Epic | Phase | ADR(s) | Status | Primary implementation | Proof |
|---|---:|---|---:|---|---|
| Core loop: broadcast → announce → watch → chat | 1 | `0002`, `0003`, `0005`, `0006`, `0009` | ✅ | `apps/web/app/broadcast/page.tsx`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx`, `packages/protocol/src/*` | `npm run smoke:e2e` |
| Landing page visuals parity (cube + animated words + icon) | 1 | `0018` (parity scope) | ✅ | `apps/web/app/dev/visuals/page.tsx`, `apps/web/src/components/landing/*` | Manual: `/dev/visuals` |
| Identity: NIP-07 preferred, local dev key; npub in URLs/UI | 1 | `0011`, `0013` | ✅ | `apps/web/src/context/IdentityContext.tsx`, `apps/web/src/lib/nostr-ids.ts` | `packages/protocol/src/protocol.test.ts` + smoke |
| Presence / viewer count (approx) | 2 | `0010` | ✅ | `apps/web/src/hooks/useStreamPresence.ts`, `packages/protocol/src/presence.ts` | Smoke (presence) |
| P2P HLS peer assist (honest UX + fallback) | 3 | `0007`, `0008`, `0015`, `0019` | ✅⚠️ | `apps/web/src/lib/p2p/*`, `apps/web/src/components/Player.tsx` | Smoke (datachannel + binary echo) |
| Dashboard UX (only over real telemetry) | 4 | (freeze requirement) | ✅ | `apps/web/app/dashboard/page.tsx` | Manual + smoke (telemetry endpoints) |
| Integrity: signed manifests + watcher verification + tamper UX | 6 | `0020` | ✅ | `services/manifest/index.mjs`, `apps/web/src/lib/integrity/*`, `apps/web/src/hooks/useStreamIntegrity.ts`, `apps/web/src/lib/p2p/hlsFragmentLoader.ts` | `npm run smoke:integrity` |
| Monero tip address in announce + watch/broadcast UX | 1 | `0017` | ✅ | `apps/web/app/broadcast/page.tsx`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx`, `packages/protocol/src/stream.ts` | Protocol tests + smoke |
| Monero verified tips (wallet RPC verification + receipts) | 7 | `0021` | ✅ | `apps/web/app/api/xmr/*`, `apps/web/src/lib/monero/*`, `services/monero-mock/index.mjs`, `packages/protocol/src/monero.ts`, `scripts/smoke-wallet-matrix.mjs` | `npm run test:monero` + `npm run smoke:wallet:matrix` |
| Stake gating / escrow (anti-leech incentives) | 8 | `0022` | ✅⚠️ | `apps/web/app/api/xmr/stake/*`, `apps/web/app/broadcast/page.tsx`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx`, `apps/web/app/dashboard/page.tsx`, `apps/web/src/lib/monero/stake*`, `packages/protocol/src/stream.ts` | `npm run test:monero` + manual watch UX |
| Wallet capability certification (tip/stake/escrow profiles) | 14 | `0026` | ✅ | `apps/web/app/api/xmr/capabilities/route.ts`, `apps/web/src/lib/monero/walletRpc.ts`, `scripts/smoke-wallet-capabilities.mjs` | `npm run smoke:wallet:cap` |
| Escrow v3 multisig coordination | 14 | `0026`, `0027` | ✅⚠️ | `apps/web/app/api/xmr/escrow/session/*`, `apps/web/src/lib/monero/escrowV3SessionStore.ts`, `apps/web/src/lib/monero/walletRpc.ts`, `apps/web/app/dashboard/page.tsx`, `services/monero-mock/index.mjs`, `scripts/smoke-escrow-v3.mjs` | `npm run smoke:escrow:v3` + `npm run test:monero` |
| Social substrate: trusted peers, keyring aliases, favorites, settings | 9 | `0018` | ✅ | `apps/web/src/context/SocialContext.tsx`, `apps/web/app/settings/page.tsx`, `apps/web/app/browse/page.tsx`, `apps/web/src/components/chat/*`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | `npm run test:social` + manual |
| Inbox / DMs (NIP-04) | 10 | `0018` | ✅ | `apps/web/app/inbox/*`, `apps/web/src/hooks/useDmInbox.ts` | `npm run test:inbox` + manual |
| Guilds / curated discovery | 11 | `0018`, `0024` | ✅ | `apps/web/app/guilds/page.tsx`, `apps/web/app/guilds/[pubkey]/[guildId]/page.tsx`, `apps/web/src/hooks/useGuildRoster.ts`, `packages/protocol/src/guild.ts`, `packages/protocol/src/guildMembership.ts` | `npm run test:protocol` + manual |
| Moderation | 12 | `0018` | ✅ | `apps/web/src/components/chat/ChatBox.tsx`, `apps/web/src/hooks/useStreamModeration.ts`, `apps/web/src/components/chat/ChatMessage.tsx`, `packages/protocol/src/moderation.ts` | `npm run test:protocol` + manual |
| Analytics dashboards | 9–12 | `0018` | ✅ | `apps/web/app/analytics/page.tsx` | Manual + smoke |
| WHEP playback (low-latency option with clean fallback) | 13 | `0023` | ✅ | `apps/web/app/api/whep/[...path]/route.ts`, `apps/web/src/lib/whep.ts`, `apps/web/src/components/Player.tsx`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | `npm run test:whep` + smoke |

## B) ADR traceability (decision → code → proof)

This section is the “nothing got lost in translation” map for ADRs `0001`–`0027`.

| ADR | Summary | Phase | Status | Primary implementation | Proof |
|---:|---|---:|---:|---|---|
| 0001 | MVP scope (deprecated by later scope ADRs) | 0–1 | ✅ | `docs/ROADMAP.md`, `docs/FEATURE_FREEZE.md` | n/a |
| 0002 | Stream identity `(pubkeyHex, streamId)` + `streamKey` | 1 | ✅ | `packages/protocol/src/nostr.ts`, `packages/protocol/src/stream.ts` | `packages/protocol/src/protocol.test.ts` |
| 0003 | Watch route encodes identity | 1 | ✅ | `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | Smoke |
| 0004 | Protocol module is shared + tested | 0–1 | ✅ | `packages/protocol/src/*` | `packages/protocol/src/protocol.test.ts` |
| 0005 | Streaming URL is a hint, not authority | 1 | ✅ | `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | Smoke (fallback) |
| 0006 | Origin required (bootstraps playback) | 1 | ✅ | `apps/web/src/lib/origin.ts`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | Smoke |
| 0007 | P2P swarm identity derived from stream identity | 3 | ✅ | `packages/protocol/src/swarm.ts`, `apps/web/src/lib/p2p/swarm.ts` | `packages/protocol/src/protocol.test.ts` |
| 0008 | P2P UX gating (no fake stats/panels) | 3 | ✅ | `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` (P2P enable + stats) | Manual + smoke |
| 0009 | Chat scoping via `a=30311:<pubkey>:<streamId>` | 1 | ✅ | `packages/protocol/src/chat.ts`, `apps/web/src/components/chat/ChatBox.tsx` | `packages/protocol/src/protocol.test.ts` + smoke |
| 0010 | Presence/viewer count (approx) | 2 | ✅ | `packages/protocol/src/presence.ts`, `apps/web/src/hooks/useStreamPresence.ts` | Smoke |
| 0011 | Identity management (NIP-07 + local dev key) | 1 | ✅ | `apps/web/src/context/IdentityContext.tsx` | Manual + smoke |
| 0012 | No central registry service; discovery via Nostr | 1 | ✅ | `apps/web/app/browse/page.tsx`, `apps/web/src/hooks/useStreamList.ts` | Manual + smoke |
| 0013 | `npub…` user-facing; hex internal canonical | 1 | ✅ | `apps/web/src/lib/nostr-ids.ts`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` | Manual + smoke |
| 0014 | Origin stream path derived as `${pubkeyHex}--${streamId}` | 1 | ✅ | `apps/web/src/lib/origin.ts` | Smoke |
| 0015 | P2P signaling via Nostr | 3 | ✅ | `packages/protocol/src/signaling.ts`, `apps/web/src/lib/p2p/nostrSignal.ts` | Smoke (signal + datachannel echo) |
| 0016 | Scope v2 (deprecated by ADR 0018) | - | ✅ | `docs/adr/0018-scope-v3-jrny-parity.md` | n/a |
| 0017 | Monero tip address announce + UX | 1 | ✅ | `packages/protocol/src/stream.ts`, `apps/web/app/broadcast/page.tsx` | `packages/protocol/src/protocol.test.ts` + smoke |
| 0018 | Scope v3: JRNY parity (“everything”) | - | ✅ | `docs/FEATURE_FREEZE.md`, `docs/JRNY_PARITY.md` | n/a |
| 0019 | P2P discovery model: Nostr-signaled is canonical | 3 | ✅⚠️ | `apps/web/src/lib/p2p/*`, `packages/protocol/src/signaling.ts` | Smoke |
| 0020 | Integrity manifests (kind `30313`) | 6 | ✅ | `services/manifest/index.mjs`, `packages/protocol/src/manifest.ts`, `apps/web/src/lib/integrity/*` | `npm run smoke:integrity` |
| 0021 | Monero verified tips (kind `30314`) | 7 | ✅ | `apps/web/app/api/xmr/*`, `apps/web/src/lib/monero/*`, `packages/protocol/src/monero.ts` | `npm run test:monero` + protocol tests |
| 0022 | Escrow/stake gating (anti-leech) | 8 | ✅⚠️ | `apps/web/app/api/xmr/stake/*`, `apps/web/app/watch/[pubkey]/[streamId]/page.tsx`, `packages/protocol/src/stream.ts` | `npm run test:monero` + manual watch UX |
| 0023 | WHEP playback | 13 | ✅ | `apps/web/app/api/whep/[...path]/route.ts`, `apps/web/src/lib/whep.ts`, `apps/web/src/components/Player.tsx` | `npm run test:whep` + smoke |
| 0024 | Guilds / curated discovery | 11 | ✅ | `packages/protocol/src/guild.ts`, `apps/web/app/guilds/*`, `apps/web/app/browse/page.tsx` | `npm run test:protocol` |
| 0025 | Escrow settlement refunds/slashing | 8 | ✅⚠️ | `apps/web/app/api/xmr/stake/*`, `apps/web/src/lib/monero/stake*`, `scripts/smoke-escrow.mjs` | `npm run smoke:escrow` + `npm run test:monero` |
| 0026 | Escrow v3 boundary + wallet certification | 14 | ✅ | `docs/adr/0026-escrow-v3-boundary-and-wallet-certification.md`, `apps/web/app/api/xmr/capabilities/route.ts`, `scripts/smoke-wallet-capabilities.mjs` | `npm run smoke:wallet:cap` |
| 0027 | Escrow v3 multisig coordination | 14 | ✅⚠️ | `docs/adr/0027-escrow-v3-multisig-coordination.md`, `apps/web/app/api/xmr/escrow/session/*`, `apps/web/src/lib/monero/escrowV3SessionStore.ts`, `scripts/smoke-escrow-v3.mjs` | `npm run smoke:escrow:v3` + `npm run test:monero` |

## C) JRNY source coverage (sanity cross-check)

This is the explicit “what did we miss?” list. If something is in JRNY’s docs/code but *not* mapped to a phase, it should show up here.

### JRNY README “Key Features”

| JRNY claim | Covered by roadmap | Notes |
|---|---|---|
| P2P HLS streaming | ✅ | Implemented, but **diverged** from tracker/WebTorrent model (ADR `0019`). |
| Decentralized discovery via Nostr | ✅ | Implemented (kind `30311`). |
| Monero staking & tipping | ✅ | Verified tips implemented (Phase 7). Stake gating implemented (Phase 8). |
| WHIP/WHEP native | ✅ | WHIP works; WHEP playback is implemented (Phase 13). |
| Trustless escrow | ✅⚠️ | Stake gating + settlement + multisig coordination are implemented; true on-chain trustless escrow is out of scope in current Monero architecture (ADRs `0026`, `0027`). |

### JRNY `FEATURES.md` heading coverage

This is intentionally **heading-level** (JRNY has 200+ atomic checkboxes); detailed atomic mapping is a follow-on doc if needed.

| JRNY area (heading) | Roadmap phase(s) | Rebuild status | Notes |
|---|---:|---:|---|
| Video - Camera | 1 | ✅ | Camera + screen preview + device selection exist in `/broadcast`. |
| Video - Broadcast | 1–2 | ✅ | Core WHIP flow works; live bitrate/FPS knobs are shipped in `/broadcast`, plus caption metadata, auto ladder hints, synthetic master playlist route (`/api/hls-master`), and compose-level origin transcoder (`services/transcoder`). |
| Video - Playback | 1–2, 13 | ✅ | HLS works; WHEP low-latency option shipped; advanced controls (PiP/fullscreen/quality selector/volume) are shipped in `Player`. |
| Video - P2P | 3 | ✅⚠️ | Real peer assist exists; not WebTorrent-tracker-based. |
| Video - Integrity | 6 | ✅ | Signed manifests + watcher-side segment verification + tamper detection are implemented. |
| Identity - Keys | 1 | ✅ | NIP-07 + local dev key + import/export + multi-local identity switching shipped (`IdentityContext`, `/settings`). |
| Identity - Profile | 9 | ✅ | Profile edit/publish (`kind:0`) + public profile page shipped (`/profile`, `/profile/[pubkey]`). |
| Identity - NIP-05 | (not frozen) | ✅ | NIP-05 input + verification badge are shipped; explicit deployment policy via `NEXT_PUBLIC_NIP05_POLICY` (`off|badge|require`) is enforced in moderation/role UI gates. |
| Identity - Keyring (Aliases) | 9 | ✅ | Local-only aliases shipped (`/settings`) and applied in chat/browse/watch. |
| Identity - Trusted Peers | 9 | ✅ | Local-only trusted list shipped (`/settings`); can gate P2P peer selection. |
| Identity - Badge | 9 | ✅ | Streamer/mod/subscriber + verified badges are rendered in chat with profile links. |
| Chat - Core | 1 | ✅ | Stream-scoped chat is implemented. |
| Chat - Badges | 12 | ✅ | Streamer/mod/subscriber/verified badges are rendered in chat. |
| Chat - Commands | 12 | ✅ | `/name`, `/mute`, `/unmute`, `/ban`, `/unban`, `/w`, `/wh(...)` shipped. |
| Chat - Whispers | 10–12 | ✅ | Stream-scoped encrypted whispers are shipped over NIP-04 DM events with whisper badges/labels. |
| Chat - Inbox (DMs) | 10 | ✅ | Implemented (NIP-04) with thread grouping + unread counts (`/inbox`). |
| Moderation - Actions | 12 | ✅ | Relay-backed stream moderation actions are published and enforced in chat (`stream mod action` events). |
| Moderation - Roles | 12 | ✅ | Stream moderator roles are published by broadcaster and consumed by chat moderation (`stream mod role` events). |
| Moderation - Settings | 12 | ✅ | Mute/block lists are editable in `/settings` and applied in chat + inbox. |
| Guilds - Core/Membership/Roles/Display | 11 | ✅ | Guild definitions + featured streams + browse integration + membership + role assignment are shipped. |
| Payments - Monero | 7 | ✅ | Verified tipping + wallet RPC implemented (receipts optional via dashboard). |
| Payments - Escrow | 8, 14 | ✅⚠️ | Stake gating + refund/slash settlement + multisig coordination are implemented; model remains non-contractual (not on-chain trustless escrow). |
| Payments - Tipping UI | 7 | ✅ | Tip address + verified subaddress (QR + check) shipped. |
| Payments - Other Methods | (explicitly out-of-scope) | ❌ | Multi-method payments are intentionally excluded by ADR `0021` (Monero-first). |
| Analytics | 9 | ✅ | Implemented at `/analytics` using real presence + Monero verification telemetry. |
| Presence | 2 | ✅ | Implemented (kind `30312`). |
| Nostr - Events | 1 | ✅ | Publish/subscribe/sign supported. |
| Nostr - Stream Announce | 1–2 | ✅ | Live/ended announces exist; heartbeat/update exist. |
| Nostr - Discovery | 1 | ✅ | Browse/search/shuffle exist (`/browse`). |
| UI - Pages | 1–4, 9–13 | ✅ | Core pages + **settings** + **inbox** + **guilds** + **profile** + **moderation** are shipped. |
| UI - Components | 1–4 | ✅ | Frozen-scope components are shipped (player controls, watch/broadcast metadata panels, social/mod tools, wallet/escrow surfaces). |
| UI - Navigation | 1–4 | ✅ | Header/nav exists; deeper IA may evolve with social modules. |
| Infrastructure | 0–6 | ✅ | Local compose works (mock + real-wallet profiles), CI baseline exists, and deployment gates exist (`ENV_FILE=.env.production npm run harden:deploy` + `EXTERNAL_BASE_URL=<public-url> npm run smoke:external:readiness`) with relay/ICE/local-endpoint checks. |

## D) Completion rule (so “done” means done)

The rebuild is only “completed” when every row in **A** is ✅ and the test bar in `docs/FEATURE_FREEZE.md` is satisfied.
