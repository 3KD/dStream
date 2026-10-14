# dStream Rebuild — Roadmap to Completion (v2)

This roadmap is designed to reach “completed” as defined in `docs/FEATURE_FREEZE.md`.

For a requirement-by-requirement map (what → why → where → proof → phase), see `docs/TRACEABILITY_MATRIX.md`.

## Phase 0 — Rebuild Scaffold (Done)

Exit criteria:

- Repo scaffold exists (`apps/web`, `packages/protocol`, `infra/stream`).
- ADRs accepted for MVP core loop + identifiers.
- `npm run smoke:e2e` passes locally.

## Phase 1 — MVP Core Loop (Ship-Quality)

Goal: the product works reliably for the core loop (broadcast → discover → watch → chat) on real relays/origins.

Deliverables:

- Broadcast studio:
  - device selection + preview + WHIP publish
  - kind `30311` announce (live/ended) with metadata
  - stream-scoped chat
  - share/copy watch link
- Watch:
  - HLS playback (hint-first, fallback-second)
  - stream-scoped chat (kind `1311`)
- Browse:
  - live discovery (kind `30311`), search, shuffle
- Identity:
  - NIP-07 preferred
  - local dev key supported
  - user-facing `npub` in URLs/UI

Exit criteria:

- No placeholder UI in MVP surfaces (hide any “future feature” UI until it’s real).
- Typecheck passes: `npm run typecheck`.
- Core smoke passes: `npm run smoke:e2e`.

## Phase 2 — Hardening + Real Telemetry (Pre-Dashboard)

Goal: make “dashboard” possible *without stubbing* by producing real broadcaster state + viewer telemetry.

Deliverables:

- Broadcast reliability:
  - resumable session UX (refresh/reconnect story)
  - clear origin/relay error states
  - announce heartbeat + manual “update announce”
- Presence (ADR 0010):
  - implement kind `30312` presence events (best-effort)
  - watch page shows approximate viewer count (labeled as approximate)
- Multi-relay behaviors:
  - publish redundancy / relay health basics
  - dedupe + ordering rules documented

Exit criteria:

- Presence is real end-to-end (no stubbed counters).
- Automated tests exist for presence + announce updates.

## Phase 3 — P2P Delivery (Phase 2 Features Become Real)

Goal: implement P2P as a real delivery path, with correct identity and honest UX.

Deliverables:

- Swarm identity (ADR 0007) implemented in protocol module.
- P2P engine integration for HLS (chosen implementation must be documented).
- UX gating (ADR 0008):
  - show P2P panel only when active + stats are real
  - feature flags documented

Exit criteria:

- At least one automated test proves peers exchange real data (not a mocked stat panel).
- Player can fall back to origin cleanly when P2P fails.

## Phase 4 — Dashboard UX (A) + “No Placeholders” Closure

Goal: port/build the dashboard shell only once the underlying system is real, then remove remaining placeholders and finish testing.

Deliverables:

- Dashboard UI that surfaces:
  - broadcaster state machine (preview/live/ended/errors)
  - presence/viewers
  - (when enabled) P2P stats
- Remove all placeholder text from user-facing UI.
- Test suite completeness:
  - protocol unit tests
  - at least one browser flow test for core loop
  - smoke remains green

Exit criteria (Project “Completed”):

- All frozen features implemented + tested.
- No stub code paths for shipped features.
- No placeholder UI text anywhere user-facing.

## Phase 5 (Optional) — Productionization + Repo Hygiene

Goal: make deployment + portability straightforward without changing the frozen feature set.

Deliverables:

- Deployment documentation (`docs/DEPLOYMENT.md`) and a checked-in `.env.example`.
- Configurable origin proxy targets for `/api/whip/*` and `/api/hls/*` (avoid hardcoded `localhost` in production).
- CI baseline (typecheck + protocol tests + lint) if/when this repo is hosted on GitHub.

Exit criteria:

- A new developer can configure relays/origin/ICE servers without reading source code.

## Phase 6 — Integrity (Manifest Signing + Verification)

Goal: make segments verifiable regardless of delivery path (origin HTTP or P2P).

Deliverables:

- Define and ship a manifest format:
  - Nostr kind + schema (ADR required)
  - epoch/windowing rules
- Origin-side hashing + publishing:
  - compute SHA-256 for every segment
  - publish signed manifests to configured relays
- Viewer verification:
  - verify manifest signature + scope
  - verify segment hashes
  - tamper UX + peer penalty hooks (if P2P enabled)

Exit criteria:

- Automated test proves a tampered segment is detected and rejected.

## Phase 7 — Monero Tipping (Verified)

Goal: ship real, privacy-preserving creator monetization rooted in Monero.

Deliverables:

- Define a Monero flow:
  - Nostr tags/events for tip address + receipts (ADR required)
  - wallet RPC verification model (ADR required)
- Watch UX:
  - tip UI (copy + QR)
  - receipt publishing (optional)
- Broadcaster UX:
  - configure wallet RPC / payout address
  - display verified tips in dashboard

Exit criteria:

- Integration tests cover receipt schema + verification logic (mocked RPC allowed).

## Phase 8 — Escrow/Staking + Incentives (Anti-Leech)

Goal: connect “stake” to swarm participation without central authority.

Deliverables:

- Define escrow/stake rules (ADR required):
  - when stake is required (e.g. unverified peers)
  - how stake is requested + verified (Monero subaddresses)
  - refund/slash triggers (what signals are accepted)
- Implement stake-gated P2P participation (honest UX; no dark patterns).
- Implement rebroadcast economics policy (ADR `0029`):
  - host-selectable mode: `P2P Economy` vs `Host-Only`
  - FCFS active rebroadcast set up to threshold `T`
  - standby queue with automatic promotion on peer drop/failure
  - fee waiver/credit eligibility based on verified contribution (not just connected status)
  - anti-abuse controls (bond/stake, identity/session checks, quality eviction)

Current baseline shipped:

- `host_mode` + `rebroadcast_threshold` are now published in kind `30311` announces.
- Broadcast UI exposes host mode and threshold controls (with settings defaults).
- Watch UI enforces `Host-Only` peer-assist disablement and applies FCFS active-set targeting using presence.
- Refund API now applies contribution-credit scoring (`creditPercentBps`) with anti-abuse gates:
  - receipt/session scope checks,
  - duplicate/stale receipt rejection,
  - per-receipt served-bytes cap,
  - minimum session age before settlement.
- P2P swarm now evicts repeated-failure peers into cooldown before re-admission.

Exit criteria:

- End-to-end demo flow exists: stake → verified viewer → P2P assist enabled.
- End-to-end demo flow exists for rebroadcast economics:
  - active set fill to `T`
  - queue rollover after drop-out
  - credit/waiver awarded only when contribution thresholds are met.

## Phase 9 — Identity + Social Modules (JRNY Parity)

Goal: ship the “social substrate” that JRNY already implies (without placeholders).

Deliverables:

- Trusted peers + ban lists (local and/or Nostr-synced as defined by ADRs).
- Keyring aliases (nickname-by-pubkey).
- Favorites (streams and/or creators) and related discovery filters.
- Settings surfaces for playback + P2P visibility + payment defaults (no dead toggles).
- Profile basics (display + edit) if required by accepted ADRs.

Exit criteria:

- No placeholder settings panels.
- Tests cover storage + scoping rules.

## Phase 10 — Inbox / DMs (NIP-04)

Goal: implement JRNY’s inbox/DM experience with real encryption/decryption and honest filtering.

Deliverables:

- Subscribe to kind `4` events (sent + received).
- Decrypt with NIP-04 (extension or local key).
- Thread grouping + unread counts.
- (Optional) trusted-only filter, consistent with trusted/banned model.

Exit criteria:

- Integration test proves decrypt + thread grouping works (mocked events allowed).

## Phase 11 — Guilds / Curated Discovery

Goal: implement guild primitives so discovery can be curated without a central registry.

Deliverables:

- Guild object format + publish/subscribe rules (ADR required).
- Guild list + featured streams.
- Browse/search integration.

Exit criteria:

- At least one test covers guild parsing + featured stream resolution.

## Phase 12 — Moderation

Goal: give broadcasters honest moderation tools grounded in the trust/keyring model.

Deliverables:

- Local ban/mute lists that apply to chat rendering + inbox filtering.
- Broadcaster-only affordances on their own stream.
- (If specified) Nostr-synced moderation lists.

Exit criteria:

- No dead moderation buttons; everything visible must work.

## Phase 13 — WHEP Playback (Low Latency)

Goal: add a WebRTC playback path (WHEP) as a first-class capability.

Deliverables:

- WHEP endpoint negotiation (origin-configured).
- Watch UX to select WHEP vs HLS (hidden unless available).
- Clean fallback to HLS on failure.

Exit criteria:

- Automated test proves WHEP fallback behavior.

## Phase 14 — Escrow v3 Boundary + Wallet Certification

Goal: eliminate escrow claim drift and make wallet compatibility explicit and testable.

Deliverables:

- Accept ADR for escrow-v3 trust boundary (no on-chain trustless over-claims).
- Ship wallet capability probe API:
  - `GET /api/xmr/capabilities`
  - profile readiness for `tip_v1`, `stake_v2`, `escrow_v3_multisig`
- Ship certification smoke:
  - `npm run smoke:wallet:cap`
- Ship escrow-v3 coordination API + smoke:
  - `POST /api/xmr/escrow/session`
  - `GET /api/xmr/escrow/session/:sessionId`
  - `POST /api/xmr/escrow/session/:sessionId/participant`
  - `POST /api/xmr/escrow/session/:sessionId/make`
  - `POST /api/xmr/escrow/session/:sessionId/exchange`
  - `POST /api/xmr/escrow/session/:sessionId/import`
  - `POST /api/xmr/escrow/session/:sessionId/sign`
  - `POST /api/xmr/escrow/session/:sessionId/submit`
  - `npm run smoke:escrow:v3`

Exit criteria:

- Capability smoke passes for configured target profile.
- Escrow-v3 smoke passes end-to-end (prepare/make/exchange/import/sign/submit).
- Docs/status/traceability reflect the same escrow trust boundary language.
