# Production Hardening Checklist

Last updated: 2026-02-13

This checklist is the deployment gate for production-like environments.

## 1) Config preflight (required)

Run:

```bash
ENV_FILE=.env.production npm run harden:deploy
```

Template dry-run:

```bash
ENV_FILE=.env.production.example npm run harden:deploy
```

Note: `.env.production.example` contains placeholders, so deploy-mode checks will fail until real production values are supplied.

The check validates:

- relay URL safety (`wss://` only in deploy mode),
- relay host safety (no loopback/private relay hosts in deploy mode),
- relay/ICE placeholder host safety (deploy mode rejects `*.example*`),
- ICE server config (TURN required),
- TURN service config sanity (`TURN_PASSWORD` non-placeholder + length>=12, `TURN_EXTERNAL_IP` public),
- public HLS hint safety (`NEXT_PUBLIC_HLS_ORIGIN` must be `https://` + non-local in deploy mode),
- proxy origin URL validity,
- production devtools state (`DSTREAM_DEVTOOLS=0`),
- Monero session secret presence/strength,
- Monero session secret placeholder rejection (`replace*`, `change-before-public-deploy*`, `changeme*`),
- Monero wallet RPC auth requirement when wallet RPC is enabled,
- Monero wallet RPC credential quality in deploy mode (non-generic username, no placeholder pass, minimum pass length),
- wallet RPC mock-origin rejection in deploy mode (`xmr-mock`),
- wallet RPC placeholder-host rejection in deploy mode (`*.example*`),
- Monero backend requirement in deploy mode (`DSTREAM_XMR_WALLET_RPC_ORIGIN` required),
- explicit non-zero refund threshold policy in deploy mode (`DSTREAM_XMR_REFUND_MIN_SERVED_BYTES`, `DSTREAM_XMR_REFUND_FULL_SERVED_BYTES`),
- refund policy bounds in deploy mode (`DSTREAM_XMR_REFUND_MAX_RECEIPTS`, `DSTREAM_XMR_REFUND_MAX_RECEIPT_AGE_SEC`, `DSTREAM_XMR_REFUND_MIN_SESSION_AGE_SEC`, `DSTREAM_XMR_REFUND_MAX_SERVED_BYTES_PER_RECEIPT`),
- NIP-05 policy config validity (`NEXT_PUBLIC_NIP05_POLICY`),
- transcoder profile sanity.

Deployment script gate:

- `infra/prod/deploy.sh` now runs this preflight automatically before rsync/build.
- deploy auto-enables the `docker-compose.real-wallet.yml` overlay when `.env.production` points wallet RPC origin at `xmr-wallet-rpc-receiver` or `xmr-wallet-rpc-sender`.
- To bypass intentionally (for temporary/dev usage only): `DSTREAM_DEPLOY_SKIP_PREFLIGHT=1`.

## 2) External surface verification (required)

Run against your deployed URL:

```bash
EXTERNAL_BASE_URL=https://stream.example.com npm run smoke:external:readiness
```

This scan checks:

- required routes return 2xx (`/`, `/browse`, `/broadcast`, `/settings`),
- public bundles/pages do not contain local-only endpoint hints (`localhost`, `127.0.0.1`, local relay defaults),
- at least one `wss://` relay hint appears in client assets,
- at least one `turn:` / `turns:` ICE hint appears in client assets.

## 3) Runtime stack verification

Run:

```bash
docker compose ps
npm run smoke:e2e
npm run smoke:integrity
npm run smoke:wallet:cap
npm run smoke:escrow
npm run smoke:escrow:v3
npm run smoke:wallet:real
npm run smoke:prod:runtime -- root@your-host
```

Notes:

- `smoke:escrow` is a mock-wallet smoke (uses `/api/dev/xmr/*`); on real-wallet stacks it exits with `SKIP`.
- `smoke:escrow:v3` in real-wallet mode auto-enables Monero multisig experimental mode on ephemeral wallets via `monero-wallet-cli` before multisig exchange.

## 4) External wallet verification

Run:

```bash
npm run smoke:wallet:matrix
```

This certifies manual transfer detection using:

- Cake Wallet
- Feather Wallet
- `monero-wallet-cli`

## 5) Session token hardening

`DSTREAM_XMR_SESSION_SECRET` is now enforced for production runtime.  
If missing in production, tip/stake session signing fails fast instead of silently using per-process random secrets.

## 6) Remaining non-code hardening

Operational hardening is now scriptable:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host npm run ops:ssh:key
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream npm run ops:healthcheck
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream DSTREAM_ALERT_WEBHOOK_URL=https://hooks.example.com/... npm run ops:healthcheck:install
SSH_TARGET=root@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:backup
```

Restore workflow (destructive, force-gated):

```bash
DSTREAM_RESTORE_FORCE=1 SSH_TARGET=root@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:restore -- /opt/dstream/backups/<timestamp-or-archive>
```

Runbook:

- `/Users/erik/Projects/JRNY/.dstream-work/docs/OPS_RUNBOOK.md`
