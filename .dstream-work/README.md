# dStream (Rebuild)

This repository is a clean rebuild scaffold based on the ADRs in `docs/adr/`.

## Quick start

```bash
npm install
npm run infra:up:test
npm run dev
```

Copy `.env.example` to `.env.local` if you want to override relays/origin/ICE servers.
Set `NEXT_PUBLIC_SUPPORT_XMR_ADDRESS` if you want `/donate` to expose a platform support address.

## Docker (all-in-one)

```bash
# Recommended (also generates a Firefox-friendly MediaMTX config)
npm run stack:up

# Real wallet stack (regtest monerod + wallet-rpc sender/receiver + wallet init)
npm run stack:up:real-wallet

# Optional: plain compose (Safari/Chrome typically ok; Firefox may fail ICE without a non-loopback host)
docker compose up -d --build
```

Web: `http://localhost:5656` (or set `DSTREAM_WEB_PORT`)

## Sanity checks

```bash
npm run check
```

## Smoke test (automated)

Works with either:

- Dev mode: `npm run infra:up:test` + `npm run dev`
- Docker mode: `docker compose up --build` (enables dev tools by default via `DSTREAM_DEVTOOLS=1`)

```bash
npm run smoke:e2e
npm run smoke:e2e:firefox
npm run smoke:escrow
npm run smoke:escrow:v3
npm run smoke:integrity
npm run smoke:integrity:firefox
npm run smoke:wallet:cap
npm run smoke:wallet:real
ENV_FILE=.env.production.example npm run harden:deploy
EXTERNAL_BASE_URL=http://127.0.0.1:5656 npm run smoke:external:readiness
```

This opens `/dev/e2e` and polls `/api/dev/log` for pass/fail markers (WHIP → HLS → announce → chat tx/rx → watch playback probe → presence → P2P).

### Wallet interoperability smoke

Use this to verify that tip detection works with wallets outside the local mock stack.

```bash
# Manual mode: creates a unique tip subaddress and polls for detection.
npm run smoke:wallet

# Matrix mode: runs Cake -> Feather -> CLI sequentially.
npm run smoke:wallet:matrix

# Wallet-specific shortcuts.
npm run smoke:wallet:cake
npm run smoke:wallet:feather
npm run smoke:wallet:cli

# Capability certification mode: checks wallet RPC method support profiles.
npm run smoke:wallet:cap

# Real-wallet autonomous mode (no manual wallet action).
npm run smoke:wallet:real

# Escrow-v3 multisig coordination flow (session + participant/coordinator actions).
npm run smoke:escrow:v3

# Optional dev shortcut (only when /api/dev/xmr/inject is enabled):
AUTO_INJECT=1 npm run smoke:wallet
AUTO_INJECT=1 npm run smoke:wallet:matrix
```

See `docs/WALLET_CERTIFICATION.md` for the Cake/Feather/CLI test protocol and evidence template.

Useful options:

- `BASE_URL` (default `http://127.0.0.1:5656`)
- `REQUIRE_CONFIRMED=0` to accept unconfirmed detection
- `EXPECT_MIN_ATOMIC=<digits>` to enforce a minimum observed amount
- `TIMEOUT_SECS=<seconds>` to extend polling window
- `REQUIRE_PROFILE=tip_v1|stake_v2|escrow_v3_multisig|none` for capability smoke
- `CAP_PROBE_MODE=active|passive` for capability smoke (`active` default, `passive` for strict real-wallet daemons)
- `ESCROW_ENABLE_MULTISIG_CLI=0|1` for `smoke:escrow:v3` real-wallet mode (`1` default; auto-enables multisig experimental flag)
- `ESCROW_MONERO_CLI_IMAGE=<image>` to override the helper image used for `monero-wallet-cli` (default `dstream-work-web`)
- `ESCROW_WALLET_VOLUME=<volume>` to override wallet volume mount used by `smoke:escrow:v3` (default `dstream-work_dstream_xmr_wallets`)

### Integrity smoke

```bash
npm run smoke:integrity
npm run smoke:integrity:firefox
```

This validates manifest verification + tamper signaling markers from `/dev/e2e`.

## Dev-only pages

- `/dev/e2e`: end-to-end runner used by `npm run smoke:e2e` (available in `npm run dev` or when `DSTREAM_DEVTOOLS=1`)
- `/dev/visuals`: landing-page visuals kit (cube + word animation). See `docs/VISUALS.md`.

## Key app pages

- `/broadcast`, `/watch/:npub/:streamId`, `/browse`
- `/settings` (social + payment defaults + identity key management)
- `/profile` and `/profile/:npub` (kind `0` publish/view)
- `/inbox`, `/guilds`, `/moderation`, `/analytics`
- `/whitepaper`, `/docs`, `/use-cases`, `/donate`

## Deployment

See `docs/DEPLOYMENT.md`, `.env.example`, and `.env.production.example`.

Before production deploys, run:

```bash
# Strict deploy gate (public relay/HLS hints, TURN present, devtools disabled).
ENV_FILE=.env.production npm run harden:deploy

# Verify deployed bundle does not leak local-only endpoints.
EXTERNAL_BASE_URL=https://stream.example.com npm run smoke:external:readiness
SSH_TARGET=root@your-host npm run smoke:prod:runtime
```

See `docs/HARDENING.md` for the full production gate checklist.
See `docs/PRODUCTION_FINALIZATION.md` for the final close-out checklist.

## Structure

- `apps/web`: Next.js app (MVP UI)
- `packages/protocol`: canonical Nostr event encode/decode + validation
- `infra/stream`: local MediaMTX stack for WHIP/HLS development

## Identifiers (important)

- **User-facing pubkeys:** `npub…` (NIP-19 bech32). This is the same public key as hex, just encoded with a checksum for copy/paste safety.
- **Internal pubkeys:** 64-char lower-case hex (canonical for Nostr event fields + tag scoping)
- **Watch route:** `/watch/:npub/:streamId` (route also accepts hex for compatibility)
- **Media origin path (WHIP/HLS):** derived from stream identity (ADR 0014)
  - `originStreamId = "${pubkeyHex}--${streamId}"`
  - WHIP: `/api/whip/${originStreamId}/whip`
  - HLS: `/api/hls/${originStreamId}/index.m3u8`
  - `streamId` must be URL-safe: `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/`

## Broadcast metadata (30311)

`/broadcast` can publish optional caption and rendition metadata in the stream announce event:

- Caption tag: `["caption", "<lang>", "<label>", "<url>", "<default-flag>"]`
- Rendition tag: `["rendition", "<id>", "<url>", "<bandwidth>", "<width>", "<height>", "<codecs>"]`
- Host policy tags:
  - `["host_mode", "p2p_economy" | "host_only"]`
  - `["rebroadcast_threshold", "<positive-int>"]` (active-set size `T` for FCFS rebroadcast queue)

Playback behavior in `/watch/:npub/:streamId`:

- If 2+ rendition tags are present, watch generates a synthetic HLS master via `/api/hls-master` and enables ladder selection in `Player`.
- If caption tags are present, watch injects subtitle tracks into the video element (native caption controls).
- If host mode is `host_only`, watch disables peer assist and surfaces host-policy reason in UI.
- If host mode is `p2p_economy`, watch applies FCFS queueing from live presence and targets active-set peers up to threshold `T`.
- Root Docker Compose also runs `transcoder`, which auto-generates derived rendition streams (`__r720p`, `__r480p`, `__r360p`) from live sources.

Stake refund anti-abuse policy:

- Refund receipts must match session scope (`sessionId`, viewer pubkey, stream scope) and pass signature checks.
- Duplicate or stale receipts are rejected; per-receipt served-bytes is capped.
- Refund session must age past a minimum window before settlement.
- Refund responses include `creditPercentBps` against a configurable full-credit served-bytes target.

Home (`/`) and browse (`/browse`) stream cards attempt periodic live preview frame sampling from each stream’s proxied HLS path, with automatic fallback to announced poster image when frame capture is unavailable.
