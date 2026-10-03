# dStream Runtime

This directory contains the canonical application deployed to [dstream.stream](https://dstream.stream). The repository root also contains a legacy implementation; do not use that tree for current development or deployment.

## Local Development

Requirements: Node.js 22, npm, Docker, and Docker Compose.

```bash
npm ci
cp .env.example .env.local
npm run infra:up:test
npm run dev
```

Open `http://localhost:5656`. The local relay and MediaMTX services use the ports documented in [../CONFIG.md](../CONFIG.md).

For the all-in-one Compose stack:

```bash
npm run stack:up
```

The optional transcoder profile requires a host sized for video encoding and is disabled by default.

## Current Runtime

- `apps/web`: Next.js UI and server API routes.
- `packages/protocol`: canonical Nostr event builders, parsers, and tests.
- `apps/mobile`: Capacitor shell for a user-selected dStream node.
- `apps/desktop`: Electron shell.
- `services/manifest`: optional segment integrity service.
- `services/transcoder`: optional rendition ladder.
- `infra`: MediaMTX, Nostr relay, TURN, and deployment configuration.

The media path is browser WHIP or external encoder RTMP/WHIP ingest, WHEP playback when available, and HLS fallback. Optional viewer assist exchanges requested HLS bytes over WebRTC data channels; the origin remains the bootstrap and fallback path.

## Configuration

Use `.env.example` for local development and `.env.production.example` as a production template. Never commit populated environment files.

Important boundaries:

- `NEXT_PUBLIC_*` values are visible in browser JavaScript.
- `NEXT_PUBLIC_WEBRTC_STUN_SERVERS` may contain public STUN URLs only.
- TURN credentials are generated from server-only `TURN_SHARED_SECRET` and expire.
- Provider API keys, RPC credentials, wallet passwords, and session secrets remain server-only.
- Public payment assets and backend verifier readiness are separate settings.

See [../CONFIG.md](../CONFIG.md) for the maintained variable reference.

## Payments

The runtime implements verified adapters for Monero, Bitcoin Lightning, UTXO chains, EVM chains, TRON, Solana, XRP Ledger, and Cardano. An adapter is inactive until its required RPC/indexer is configured. A public deployment should expose only the assets it deliberately supports.

dstream.stream currently requires these production capabilities:

- `xmr:xmr`
- `btc:lightning`
- `btc:utxo`

Inspect `/api/payments/capabilities` and `/api/payments/health` for runtime state. Do not infer active support from source code alone.

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Focused checks are available for streaming, payments, playback access, mobile shells, layouts, wallet interoperability, and production readiness. Run the smallest relevant set during development, then the full checks before release.

Common production checks:

```bash
npm run harden:deploy -- .env.production
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
EXTERNAL_BASE_URL=https://your-domain npm run smoke:prod:runtime
EXTERNAL_BASE_URL=https://your-domain SSH_TARGET=user@your-host npm run gate:prod -- .env.production
```

## Deployment

From this directory:

```bash
./infra/prod/deploy.sh user@your-host
```

From the repository root:

```bash
DSTREAM_DEPLOY_PROJECT_DIR="$PWD/.dstream-work" ./infra/prod/deploy.sh user@your-host
```

A deploy is not complete until the public routes, runtime health, asset version, and changed user-visible behavior have been verified. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/HARDENING.md](docs/HARDENING.md), and [docs/OPS_RUNBOOK.md](docs/OPS_RUNBOOK.md).

## Documentation

- [Public overview](../README.md)
- [Feature status](../FEATURES.md)
- [Protocol reference](../PROTOCOL.md)
- [Architecture](../ARCHITECTURE.md)
- [Runtime documentation index](docs/README.md)
