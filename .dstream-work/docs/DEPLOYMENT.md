# Deployment Notes (v1)

dStream is designed as a decentralized *control plane* (Nostr) with a replaceable *media plane* (origin seed + optional peer assist).

## Mental model

- **Identity / discovery / chat / presence / signaling:** Nostr events published to relays.
- **Media ingest (broadcast):** WHIP/WebRTC → an origin/seed (MediaMTX in dev).
- **Media playback (watch):** WHEP/WebRTC (preferred when available) → the origin/seed, with HLS fallback and default-on P2P assist for HLS.
- **No central registry:** “Live streams” are discovered by subscribing to announce events (kind `30311`) on configured relays.
- **Directory previews (home/browse):** cards periodically sample current frames from proxied HLS paths; if sampling fails, clients fall back to announced `image` metadata.

The *canonical* stream identity is `(pubkeyHex, streamId)`. The user-facing route uses `npub…` for safety.

P2P default behavior:

- Watchers attempt relay-signaled P2P assist by default.
- If a user has no connected Nostr identity, watch creates an in-memory ephemeral signal identity for P2P-only participation.
- Stake-gated streams still require a real connected identity + confirmed stake before P2P assist is enabled.

## Environment variables

See `.env.example`. Quick reference:

**Client/public**
- `NEXT_PUBLIC_NOSTR_RELAYS`: relay list (CSV or JSON array).
- `NEXT_PUBLIC_HLS_ORIGIN`: base URL for the announce “streaming hint”.
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS`: ICE server URLs (CSV or JSON array). For authenticated TURN, use JSON objects with `urls`, `username`, `credential`.
- `NEXT_PUBLIC_NIP05_POLICY`: `off|badge|require` policy for NIP-05 UI enforcement.
- `NEXT_PUBLIC_SUPPORT_XMR_ADDRESS`: optional platform support donation address shown on `/donate`.

**TURN (bundled compose service)**
- `TURN_REALM`: TURN realm (default `dstream.stream`).
- `TURN_USERNAME`: static TURN username.
- `TURN_PASSWORD`: static TURN password (must not be placeholder in deploy mode).
- `TURN_EXTERNAL_IP`: public server IP advertised by coturn.
- `TURN_PORT`: TURN listening port (default `3478`).
- `TURN_MIN_PORT` / `TURN_MAX_PORT`: relay allocation port range.

**Server-only (web reverse proxy)**
- `DSTREAM_WHIP_PROXY_ORIGIN`: where `/api/whip/*` proxies to.
- `DSTREAM_WHEP_PROXY_ORIGIN`: where `/api/whep/*` proxies to (defaults to `DSTREAM_WHIP_PROXY_ORIGIN`).
- `DSTREAM_HLS_PROXY_ORIGIN`: where `/api/hls/*` proxies to.

**Server-only (Monero verified tips)**
- `DSTREAM_XMR_WALLET_RPC_ORIGIN`: Monero wallet RPC origin (expects `POST <origin>/json_rpc`).
- `DSTREAM_XMR_WALLET_RPC_USER` / `DSTREAM_XMR_WALLET_RPC_PASS`: Basic auth (required in hardened production when wallet RPC is enabled).
- `DSTREAM_XMR_ACCOUNT_INDEX`: account index used for allocating subaddresses (default `0`).
- `DSTREAM_XMR_CONFIRMATIONS_REQUIRED`: confirmations required for “confirmed” tips (default `10`).
- `DSTREAM_XMR_REFUND_MIN_SERVED_BYTES`: minimum served-bytes receipts required for stake refunds (default `0`).
- `DSTREAM_XMR_REFUND_FULL_SERVED_BYTES`: served-bytes target for 100% credit score (`creditPercentBps=10000`) in refund responses (default = `DSTREAM_XMR_REFUND_MIN_SERVED_BYTES`).
- `DSTREAM_XMR_REFUND_MAX_RECEIPTS`: max receipt events accepted per refund request (default `32`).
- `DSTREAM_XMR_REFUND_MAX_RECEIPT_AGE_SEC`: max receipt age window for refund eligibility (default `900`).
- `DSTREAM_XMR_REFUND_MAX_SERVED_BYTES_PER_RECEIPT`: anti-abuse cap for a single receipt payload (default `536870912`).
- `DSTREAM_XMR_REFUND_MIN_SESSION_AGE_SEC`: minimum stake-session age before refund can settle (default `30`).
- `DSTREAM_XMR_STAKE_SLASH_MIN_AGE_SEC`: minimum age since latest stake transfer before slash is allowed (default `3600`).
- `DSTREAM_XMR_SESSION_SECRET`: HMAC secret for tip/stake session tokens (**required in production**).
- `DSTREAM_XMR_ESCROW_SESSION_TTL_SEC`: escrow-v3 multisig session TTL in seconds (default `3600`).
- `DSTREAM_XMR_WALLET_FILE_PASS`: wallet-file password used by real-wallet init flow.
- `DSTREAM_XMR_RECEIVER_WALLET_NAME` / `DSTREAM_XMR_SENDER_WALLET_NAME`: wallet filenames for real-wallet stack bootstrap.

**Server-only (origin ladder transcoder)**
- `TRANSCODER_SOURCE_HLS_BASE`: source HLS base for reading live origin playlists (default `http://mediamtx:8880`).
- `TRANSCODER_OUTPUT_RTMP_BASE`: RTMP publish base for derived renditions (default `rtmp://mediamtx:1935`).
- `TRANSCODER_PROFILES`: comma-separated profile spec `id:width:height:videoBitrate:audioBitrate`.
- `TRANSCODER_POLL_MS`: source scan interval (default `2500`).
- `TRANSCODER_STALE_MS`: source inactivity cutoff before stopping transcodes (default `12000`).
- `TRANSCODER_MAX_STREAMS`: max concurrent source streams transcoded (default `24`).

In development, the defaults match `infra/stream`:
- WHIP proxy → `http://localhost:8889`
- WHEP proxy → `http://localhost:8889`
- HLS proxy → `http://localhost:8888` (host port mapped to MediaMTX `:8880`)

## Deployment patterns

### Pattern A — Single host (simplest)

Run the web app and an origin (MediaMTX or equivalent) on the same host/network.

- Keep `DSTREAM_*_PROXY_ORIGIN` pointing at the origin from the web app’s perspective.
- Set `NEXT_PUBLIC_HLS_ORIGIN` to the *publicly reachable* base URL of HLS if you want watchers to prefer direct origin playback via the announce hint.

### Pattern B — Docker Compose (recommended for self-host)

This repo includes a ready-to-run `docker-compose.yml` at the repo root that runs:
- `web` (Next.js)
- `mediamtx` (origin seed)
- `relay` (local Nostr relay)
- `xmr-mock` (dev-only mock Monero wallet RPC used for verified tip flows)
- `manifest` (optional: integrity manifest signer; see ADR `0020`)
- `hls-init` (one-shot volume permission fix for `/hls`)

Start it:

```bash
# Recommended (also generates a host-IP MediaMTX config for browsers that reject loopback ICE candidates)
npm run stack:up

# Optional: plain compose (may fail WHIP ICE on some setups; prefer stack:up)
docker compose up -d --build
```

Real-wallet variation (regtest daemon + sender/receiver wallet-rpc + wallet bootstrap):

```bash
npm run stack:up:real-wallet
```

Production deploy note:

- `infra/prod/deploy.sh` automatically adds `docker-compose.real-wallet.yml` when `.env.production` sets `DSTREAM_XMR_WALLET_RPC_ORIGIN` to `xmr-wallet-rpc-receiver` or `xmr-wallet-rpc-sender`.
- Set `DSTREAM_DEPLOY_REAL_WALLET=1` to force, or `DSTREAM_DEPLOY_REAL_WALLET=0` to disable.

Then open:
- Web app: `http://localhost:5656` (or set `DSTREAM_WEB_PORT` to change the host port)
- Relay (for browsers): `ws://localhost:8081`

### Monero verified tips (local dev)

Root Compose runs a lightweight mock wallet RPC (`xmr-mock`) so verified-tip flows can be exercised without a real Monero wallet.

- Health check: `GET /api/xmr/health`
- Create tip session: `POST /api/xmr/tip/session`
- Check tip status: `GET /api/xmr/tip/session/<token>`
- Dev-only helpers (requires `DSTREAM_DEVTOOLS=1`):
  - Reset mock state: `POST /api/dev/xmr/reset`
  - Inject a transfer (simulated tip): `POST /api/dev/xmr/inject` with either `{ "session": "<token>", ... }` or `{ "address": "<subaddress>", ... }`

For a full local real-wallet path without manual wallet interaction:

- Bring up real stack: `npm run stack:up:real-wallet`
- Run autonomous smoke: `npm run smoke:wallet:real`

### Wallet interoperability verification

To validate compatibility with external wallets (GUI/mobile/CLI), run:

```bash
npm run smoke:wallet
npm run smoke:wallet:matrix
npm run smoke:wallet:cap
npm run smoke:escrow
npm run smoke:escrow:v3
```

The script creates a unique tip subaddress and polls `/api/xmr/tip/session/<token>` until a transfer is detected (and confirmed by default).
You can send from any wallet that supports standard Monero transfers to subaddresses.

Capability smoke queries `GET /api/xmr/capabilities` and verifies wallet-method profiles:

- `tip_v1`
- `stake_v2`
- `escrow_v3_multisig`

Escrow-v3 smoke exercises coordinator/participant multisig session coordination routes end-to-end:

- create session
- participant prepare joins
- coordinator make/exchange
- multisig info import
- multisig sign/submit

Options:

- `REQUIRE_CONFIRMED=0` to accept unconfirmed detection.
- `EXPECT_MIN_ATOMIC=<digits>` to enforce a minimum expected amount.
- `TIMEOUT_SECS=<seconds>` to extend polling.
- `AUTO_INJECT=1` for local mock-only automation via `/api/dev/xmr/inject`.
- `REQUIRE_PROFILE=tip_v1|stake_v2|escrow_v3_multisig|none` for `smoke:wallet:cap`.
- `CAP_PROBE_MODE=active|passive` for `smoke:wallet:cap` (use `passive` with strict real-wallet daemons).
- `ESCROW_ENABLE_MULTISIG_CLI=0|1` for `smoke:escrow:v3` real-wallet mode (`1` default).
- `ESCROW_MONERO_CLI_IMAGE=<image>` to override helper image for `monero-wallet-cli` in `smoke:escrow:v3`.
- `ESCROW_WALLET_VOLUME=<volume>` to override wallet volume mount for `smoke:escrow:v3`.

`smoke:wallet:matrix` runs a sequential certification flow for:

- `cake`
- `feather`
- `cli`

Use wallet-specific shortcuts when needed:

```bash
npm run smoke:wallet:cake
npm run smoke:wallet:feather
npm run smoke:wallet:cli
```

For full evidence capture, use `docs/WALLET_CERTIFICATION.md`.

### Production hardening preflight

Before deployment, run:

```bash
ENV_FILE=.env.production npm run harden:deploy
EXTERNAL_BASE_URL=https://stream.example.com npm run smoke:external:readiness
```

Then run runtime verification against your host:

```bash
SSH_TARGET=root@your-host npm run smoke:prod:runtime
```

This validates production-critical config, including:

- relay URL safety (`wss://` only in deploy mode),
- relay host safety (no loopback/private relay hosts in deploy mode),
- placeholder host rejection in deploy mode (`*.example*`),
- ICE server configuration (STUN/TURN),
- TURN password and external-IP sanity for bundled coturn (`TURN_PASSWORD`, `TURN_EXTERNAL_IP`),
- public HLS origin safety (`https://` + non-local host in deploy mode),
- proxy origin URL correctness,
- production devtools disabled (`DSTREAM_DEVTOOLS=0`),
- Monero session secret requirement,
- Monero session secret placeholder rejection,
- mock wallet RPC rejection in deploy mode (`xmr-mock`),
- Monero backend origin required in deploy mode,
- transcoder profile sanity checks.

`infra/prod/deploy.sh` runs `harden:deploy` automatically before syncing/building. Use `DSTREAM_DEPLOY_SKIP_PREFLIGHT=1` only for temporary non-production deploys.

To validate a specific env file without exporting it into your shell:

```bash
ENV_FILE=.env.production npm run harden:deploy
```

To lint the committed template syntax before filling real secrets/hosts:

```bash
ENV_FILE=.env.production.example npm run harden:check
```

Note: deploy-mode checks are expected to fail on `.env.production.example` until placeholders are replaced.

See also `docs/HARDENING.md`.

### Automatic ladder generation

Root compose includes a `transcoder` service that watches active origin streams and publishes derived renditions back into MediaMTX:

- `<originStreamId>__r720p`
- `<originStreamId>__r480p`
- `<originStreamId>__r360p`

`/broadcast` can auto-publish these rendition hints in kind `30311` announces. `/watch` consumes them and builds a synthetic master playlist via `/api/hls-master`.

When the web app runs in a container, `localhost` inside that container is **not** the host. Set:
- `DSTREAM_WHIP_PROXY_ORIGIN` to the origin service name + port (e.g. `http://mediamtx:8889`)
- `DSTREAM_HLS_PROXY_ORIGIN` to the origin service name + port (e.g. `http://mediamtx:8880` if you expose internal port)

Note: Next.js **public** env vars (`NEXT_PUBLIC_*`) are inlined into the client bundle at build time. If you change relays/origin/ICE servers, rebuild the image.

Note: server-only proxy vars (`DSTREAM_*_PROXY_ORIGIN`) are read at runtime by the `/api/whip/*`, `/api/whep/*`, and `/api/hls/*` route handlers; changing them requires a container restart, not an image rebuild.

Tip: for Compose variable overrides, copy `.env.example` to `.env` and edit values before building.

If you already have the dev server / local infra running on these ports, stop them first (port conflicts), or change `DSTREAM_WEB_PORT`.

### Firefox note (WHIP ICE + loopback)

Some Firefox setups won’t accept loopback ICE candidates (`127.0.0.1`) from MediaMTX when running in Docker Desktop.

- `npm run stack:up` handles this by generating `/tmp/dstream-mediamtx.yml` and starting Compose with `DSTREAM_MEDIAMTX_CONFIG=/tmp/dstream-mediamtx.yml`.
- Manual alternative:
  - `npm run mediamtx:gen`
  - `DSTREAM_MEDIAMTX_CONFIG=/tmp/dstream-mediamtx.yml docker compose up -d --no-deps --force-recreate mediamtx`

### Nostr relays

- Dev uses a local relay at `ws://localhost:8081`.
- Production should use multiple `wss://` relays for redundancy.

### ICE servers (important off-LAN)

On real networks, WebRTC often needs STUN and sometimes TURN.

- Set `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` to at least one STUN URL.
- If you expect restrictive NATs/firewalls, add TURN as well.

## Notes / non-goals (v1)

- No account system, no central registry, no DRM.
- Presence is approximate by design (best-effort viewer pings).
