# dStream Rebuild — Status

Last updated: 2026-04-26

## Current state

- ✅ Web app running on `http://localhost:5656`
- ✅ Requirements traceability: `docs/TRACEABILITY_MATRIX.md`
- ✅ Local stack (root `docker-compose.yml`): web + MediaMTX + local Nostr relay + manifest signer (+ `hls-init` volume perms)
- ✅ One-command bring-up: `npm run stack:up` (also generates a Firefox-friendly MediaMTX config when needed)
- ✅ Real-wallet local stack profile: `npm run stack:up:real-wallet` (regtest `monerod` + sender/receiver wallet-rpc + wallet bootstrap)
- ✅ Automated smoke tests:
  - `npm run smoke:e2e` (Safari): synthetic media → WHIP → HLS → announce → chat tx/rx → watch probe → presence → P2P binary echo
  - `npm run smoke:e2e:firefox` (Firefox): same flow + generated MediaMTX config
  - `npm run smoke:integrity` (Safari): same flow + manifest verification + tamper marker
  - `npm run smoke:integrity:firefox` (Firefox): same flow + generated MediaMTX config
  - `npm run smoke:payments`: route-level payment-session smoke for XMR wallet-rpc subaddress settlement, Lightning operator settlement, EVM/Solana/TRON/UTXO/XRPL/Cardano operator sessions, viewer unlock readback, and private archive playback-token issuance
  - `npm run smoke:payments:live`: configured-provider smoke for XMR wallet-rpc, optional Lightning health, UTXO nodes, EVM, Solana, TRON, XRPL, and Cardano providers; unconfigured rails are skipped unless `PAYMENT_LIVE_SMOKE_REQUIRE_CONFIGURED=1`
  - `npm run smoke:wallets:qa`: rail-wide wallet certification readiness for XMR, Lightning, EVM, Solana, TRON, BTC, DOGE, BCH, XRPL, and Cardano, including missing env and funded-wallet pass criteria
  - `npm run smoke:escrow`: stake session + wallet inject + viewer refund + broadcaster slash settlement (mock wallet mode; prints `SKIP` on real-wallet stacks)
  - `npm run smoke:escrow:v3`: multisig coordination session (prepare/make/exchange/import/sign/submit in mock mode; real-wallet mode validates up to exchange/import with automatic multisig-experimental enablement)
  - `npm run smoke:wallet`: wallet interoperability smoke (tip subaddress allocation + detection/confirmation polling; supports external wallets)
  - `npm run smoke:wallet:matrix`: sequential wallet certification (`cake`, `feather`, `cli`)
  - `npm run smoke:wallet:cap`: wallet capability certification (profiles: `tip_v1`, `stake_v2`, `escrow_v3_multisig`)
  - `npm run smoke:wallet:real`: autonomous real-wallet transfer confirmation flow (no manual wallet action)
  - `ENV_FILE=.env.production npm run harden:deploy`: strict deploy preflight gate
  - `EXTERNAL_BASE_URL=<public-url> npm run smoke:external:readiness`: external bundle/runtime readiness gate
- ✅ v1 core loop + Phase 2/3 features implemented + tested (see `docs/ROADMAP.md` through Phase 5)
- ✅ Phase 9 social substrate shipped (local-only): trusted/muted/blocked lists, keyring aliases, favorites, settings UI (`/settings`)
- ✅ Phase 10 inbox/DMs shipped (NIP-04): thread list + unread counts + send/receive (`/inbox`)
- ✅ Phase 11 guilds/curated discovery shipped: kind `30315` guild definitions + `/guilds` + featured streams + browse curated filter
- ✅ Phase 12 moderation shipped: relay-backed stream moderation actions + moderator roles, with remote enforcement in chat plus local mute/block controls
- ✅ Phase 13 WHEP playback shipped (low latency WebRTC): WHEP preferred when available; automatic fallback to HLS on failure
- ✅ P2P assist defaults shipped: enabled by default for watch, ephemeral in-memory signal identity fallback when no connected identity, stake-gated streams still require verified stake
- ✅ Identity/profile parity shipped: multi-local key management (import/export/switch/remove), profile publish/edit (`kind 0`), and public profile pages (`/profile`, `/profile/[pubkey]`)
- ✅ Chat parity shipped: badges (streamer/mod/subscriber/verified), slash commands (`/name`, `/mute`, `/unmute`, `/ban`, `/unban`, `/w`, `/wh(...)`), and stream-scoped encrypted whispers
- ✅ Playback control parity shipped: low-latency toggle, quality selector/indicator, PiP, fullscreen, and explicit volume control in `Player`
- ✅ Broadcast tuning controls shipped: optional video max bitrate + max FPS controls in `/broadcast` (applied to constraints + WHIP sender parameters)
- ✅ Broadcast metadata parity shipped: optional caption tracks + rendition ladder hints in `/broadcast`, carried in kind `30311` announces and consumed by `/watch` (`/api/hls-master` for multi-rendition playback)
- ✅ Origin ladder generation shipped (docker compose): `transcoder` service auto-derives 720p/480p/360p renditions as sibling MediaMTX stream paths (`__r720p`, `__r480p`, `__r360p`)
- ✅ Home + browse cards now support live preview frames sampled from current HLS streams (periodic refresh, with fallback to announce image)
- ✅ Site footer restored globally with protocol/support links and dedicated routes: `/whitepaper`, `/docs`, `/use-cases`, `/donate`
- ✅ Escrow settlement v2 shipped (trust-minimized): viewer refund route + broadcaster slash route using wallet RPC subaddress sweeps
- ✅ Escrow v3 multisig coordination shipped: session + participant joins + coordinator make/exchange/import/sign/submit routes under `/api/xmr/escrow/session/*` plus dashboard control surface (`/dashboard`)
- ✅ Real-wallet escrow-v3 smoke auto-enables Monero multisig experimental mode for ephemeral wallets via `monero-wallet-cli` before exchange.
- ✅ Analytics dashboard shipped: `/analytics` (real presence + Monero tip/stake telemetry)
- ✅ Multi-asset payout rails shipped in broadcast/watch/settings (XMR, ETH, BTC, USDT, XRP, USDC, SOL, TRX, DOGE, BCH, ADA, PEPE). Paid archive access now runs through payment sessions before grant: Monero package purchases use wallet-rpc subaddresses, Lightning can allocate zap-bound invoices from LNURL/Lightning-address targets, EVM/Solana/TRON/UTXO/Cardano use built-in amount-delta observation, and XRPL uses destination tags or amount deltas. Every verified rail normalizes into the same contract (`PaymentSettlementProof` → `VerifiedPaymentSettlement`).
- ✅ The node-operator HTTP boundary is explicit and versioned in `docs/PAYMENT_OPERATOR_API.md`, with built-in same-origin operator routes at `/api/payment-operator/sessions/*`, readiness reporting at `/api/payment-operator/readiness`, and route-level smoke coverage for XMR, Lightning, EVM, Solana, TRON, UTXO, XRPL, and Cardano session flows.
- ✅ Non-XMR paid archive packages are operator-first by default in the package settings UI: saves auto-wire the built-in local operator when no custom endpoint is supplied, `operator_observed` is enforced for those rails, and legacy client-proof fallback stays behind an explicit dev flag.
- ✅ Operator setup/readiness UI and viewer unlock timeline are now part of the app: `/settings/monetization` shows health/config/readiness per rail, and the watch unlock panel shows session creation, target allocation, wallet/proof, verifier, and access grant/failure steps.
- ✅ Wallet QA is explicit across rails: `docs/WALLET_CERTIFICATION.md` defines the funded-wallet pass standard, and `npm run smoke:wallets:qa` reports concrete readiness for XMR, Lightning, EVM, Solana, TRON, UTXO, XRPL, and Cardano wallet certification.
- ✅ The payment productionization queue in `docs/PAYMENT_RAIL_COMPLETION_QUEUE.md` is complete: readiness UI, live provider smoke, viewer timeline, docs cleanup, operator security hardening, buyer wallet UX polish, and lint warning cleanup are all done.
- ✅ Escrow trust boundary remains explicit: current model is multisig coordination + origin-enforced settlement, not on-chain contract escrow
- ✅ Mobile store-release automation shipped: Fastlane lanes + signing/env checks + scripted release commands for TestFlight/App Store and Play internal/production (`docs/MOBILE_STORE_DEPLOY.md`)

## ADR implementation checklist

- ADR 0001 (MVP scope): ✅ completed (but deprecated; superseded by ADR 0016)
- ADR 0002 (Stream identity): ✅ `streamKey = "${pubkey}:${streamId}"`
- ADR 0003 (Watch route): ✅ `/watch/:npub/:streamId` (accepts hex too)
- ADR 0004 (Protocol module): ✅ `packages/protocol` used by web app
- ADR 0005 (Streaming URL hints): ✅ `streaming` tag treated as hint; fall back to same-origin HLS proxy in dev
- ADR 0006 (Origin required): ✅ HLS origin assumed (MediaMTX in dev)
- ADR 0007 (P2P swarm identity): ✅ Implemented in protocol (`deriveSwarmId`)
- ADR 0008 (P2P UX gating): ✅ P2P telemetry remains real-data only; controls can show disabled with explicit gating reason
- ADR 0009 (Chat scope): ✅ kind `1311` scoped by `a=30311:<pubkey>:<streamId>`
- ADR 0010 (Presence/viewer count): ✅ kind `30312` presence + approximate viewer count UI
- ADR 0011 (Identity management): ✅ NIP-07 + local dev key (localStorage)
- ADR 0012 (No central registry): ✅ Discovery uses Nostr (kind `30311`)
- ADR 0013 (NIP-19 user-facing): ✅ Emit `npub` in URLs/UI; normalize to hex internally
- ADR 0014 (Origin stream path): ✅ Media origin path derived from `${pubkeyHex}--${streamId}`
- ADR 0015 (P2P signaling via Nostr): ✅ Protocol + dev datachannel handshake over Nostr relay
- ADR 0016 (Scope v2): ✅ accepted, but deprecated (superseded by ADR 0018)
- ADR 0017 (Monero tip address): ✅ `xmr` tag in announces + watch UI support panel
- ADR 0018 (Scope v3 / JRNY parity): ✅ accepted + implemented; on-chain trustless escrow remains explicitly out-of-scope in this architecture
- ADR 0019 (P2P discovery model): ✅ Canonical P2P signaling is via Nostr relays (kind `8108`)
- ADR 0020 (Integrity manifests): ✅ end-to-end (origin signer + watcher verification + tamper smoke test)
- ADR 0021 (Monero verified tips): ✅ wallet RPC integration + watch/dashboard UX + tests
- ADR 0022 (Stake gating): ✅ stake-gated P2P assist + wallet RPC verification + broadcast/watch/dashboard UX
- ADR 0023 (WHEP playback): ✅ `/api/whep/*` proxy + watch player WHEP negotiation + HLS fallback
- ADR 0024 (Guilds / curated discovery): ✅ kind `30315` + guild pages + browse integration + protocol tests
- ADR 0025 (Escrow settlement refunds/slashing): ✅ accepted + implemented (receipt-aware refund + slash route + wallet sweep settlement)
- ADR 0026 (Escrow v3 boundary + wallet certification): ✅ accepted + implemented (`/api/xmr/capabilities`, `npm run smoke:wallet:cap`)
- ADR 0027 (Escrow v3 multisig coordination): ✅ accepted + implemented (`/api/xmr/escrow/session/*`, `npm run smoke:escrow:v3`)
- ADR 0028 (Mobile app distribution + node model): ✅ accepted + implemented (Capacitor shell + user-owned node bootstrap model)
- ADR 0029 (Rebroadcast queue + hosting economy modes): ✅ phase 2 implemented (`host_mode` + `rebroadcast_threshold` announces, broadcast/watch policy UI, FCFS active-set targeting, refund credit scoring + anti-abuse receipt/session gates, P2P failure eviction cooldown)

## Known open decisions (potential drift)

- P2P discovery parity: tracker/WebTorrent support is optional future work (ADR 0019); decide later if a second backend is worth it.
- ADR 0029 operator redemption accounting is still product-policy dependent:
  - `creditPercentBps` is now computed and hardened by deploy gate thresholds,
  - how credits map to external billing/ledger systems remains an operator integration decision.
