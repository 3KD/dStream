# Production Hardening Checklist

Last updated: 2026-02-12

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

The check validates:

- relay URL safety (`wss://` only in deploy mode),
- relay host safety (no loopback/private relay hosts in deploy mode),
- ICE server config (TURN required),
- public HLS hint safety (`NEXT_PUBLIC_HLS_ORIGIN` must be `https://` + non-local in deploy mode),
- proxy origin URL validity,
- production devtools state (`DSTREAM_DEVTOOLS=0`),
- Monero session secret presence/strength,
- Monero wallet RPC auth requirement when wallet RPC is enabled,
- NIP-05 policy config validity (`NEXT_PUBLIC_NIP05_POLICY`),
- transcoder profile sanity.

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

Still required before public launch:

- Production relay fleet policy (minimum two reliable `wss://` relays).
- Operational wallet RPC network boundaries and backup/restore policy.
- Monitoring/alerting and incident response runbook.
