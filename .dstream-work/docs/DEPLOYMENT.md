# Deployment Guide

Last reconciled: 2026-10-03

This guide covers the canonical `.dstream-work` runtime. It does not describe the legacy root application.

## Runtime Model

- Nostr relays carry identity, discovery, chat, presence, moderation, guild, report, and peer-signaling events.
- MediaMTX provides the replaceable ingest/origin seed: browser WHIP or encoder RTMP/WHIP in, WHEP and HLS out.
- Optional browser peer assist exchanges requested HLS bytes after peers connect. The origin remains the bootstrap and fallback path.
- Payment destinations remain creator controlled. Server-side verifiers confirm settlement only for configured rails.

## Requirements

- Node.js 22 and npm for local validation.
- Docker Engine with the Compose plugin on the deployment host.
- SSH and rsync access to the deployment host.
- A populated, untracked `.env.production` based on `.env.production.example`.
- DNS and TLS routing for the public domain.

Read [`../../CONFIG.md`](../../CONFIG.md) before supplying values. Never put wallet seeds, private keys, RPC passwords, provider API keys, session secrets, or permanent TURN credentials in a `NEXT_PUBLIC_*` variable.

## Local Stack

From `.dstream-work`:

```bash
npm ci
npm run stack:up
```

The stack includes the web application, MediaMTX, TURN, a local Nostr relay, and the optional manifest service. The transcoder is disabled unless the `transcoding` Compose profile is enabled on a host sized for encoding.

Local defaults are documented in [`../../CONFIG.md`](../../CONFIG.md). Use `npm run stack:down` to stop the base stack.

## Production Preflight

Validate the exact production file before syncing anything:

```bash
ENV_FILE=.env.production npm run harden:deploy
```

The production template intentionally contains placeholders and is expected to fail deploy-mode validation until the operator replaces them.

The preflight checks public relay/STUN/HLS values, server-only proxy and TURN values, credential quality, production devtool state, persistent payment configuration, required verifier readiness configuration, and optional transcoder settings. Some checks cover retained experimental XMR contribution/refund code; passing those checks does not make those paths public launch features.

## Deploy

From the repository root, pin the canonical project explicitly:

```bash
DSTREAM_DEPLOY_PROJECT_DIR="$PWD/.dstream-work" ./infra/prod/deploy.sh user@your-host
```

From `.dstream-work`, the wrapper pins that directory automatically:

```bash
./infra/prod/deploy.sh user@your-host
```

The deploy script:

1. Runs the production hardening preflight.
2. Syncs the selected canonical project to `/opt/dstream` by default.
3. Preserves excluded production backup files and edge-proxy state.
4. Checks remote disk headroom.
5. Builds or transfers the selected application images.
6. Restarts the Compose services.
7. Reconnects the Caddy edge proxy.
8. Runs route health checks and the production runtime smoke.

Do not set `DSTREAM_DEPLOY_SKIP_PREFLIGHT=1` for a production release.

Useful overrides:

- `DSTREAM_DEPLOY_REMOTE_DIR`
- `DSTREAM_DEPLOY_DOMAIN`
- `DSTREAM_DEPLOY_LOCAL_BUILD_SERVICES`
- `DSTREAM_DEPLOY_REAL_WALLET`
- `DSTREAM_DEPLOY_MIN_FREE_GB`

The real-wallet overlay is selected automatically when the production wallet RPC origin points to the bundled receiver or sender service. Otherwise the base stack uses the configured external wallet RPC.

## Payment Readiness

An adapter in source code is not an active payment rail. After deployment, inspect:

```text
GET /api/payments/capabilities
GET /api/payments/health
```

The public dstream.stream scope currently requires:

- `xmr:xmr`
- `btc:lightning`
- `btc:utxo`

Other adapters remain configuration-dependent and should not be exposed until their real RPC/indexer path has passed a live settlement smoke.

## Verification

Run the external and remote gates against the deployed host:

```bash
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
SSH_TARGET=user@your-host DSTREAM_DEPLOY_DOMAIN=your-domain npm run smoke:prod:runtime
EXTERNAL_BASE_URL=https://your-domain SSH_TARGET=user@your-host npm run gate:prod -- .env.production
```

These checks verify routes, public asset configuration, container/runtime health, media proxy health, and payment capability health. They do not replace a real broadcast acceptance pass.

Use two devices or browsers on different networks to verify:

1. Browser or OBS ingest is detected.
2. The live announcement reaches more than one configured relay.
3. A fresh Browse page lists the stream as live.
4. The direct watch route starts and remains stable.
5. Chat works in both directions.
6. Ending the stream publishes `status=ended` and removes it from Live Now.

## Operations

- Hardening: [`HARDENING.md`](HARDENING.md)
- Health, backups, and restore: [`OPS_RUNBOOK.md`](OPS_RUNBOOK.md)
- Release acceptance: [`PRODUCTION_FINALIZATION.md`](PRODUCTION_FINALIZATION.md)

Next.js compiles `NEXT_PUBLIC_*` values into browser assets, so changing one requires a web image rebuild. Server-only proxy values are read at runtime and require a container restart.
