# Production Finalization Checklist

This is the close-out checklist for calling dStream production complete.

## 1) Secrets and endpoints (must be real)

- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` uses real STUN/TURN infrastructure (no `turn.example.com`).
- `DSTREAM_XMR_WALLET_RPC_ORIGIN` points to a real wallet RPC service (not `xmr-mock`).
- `DSTREAM_XMR_WALLET_RPC_USER` and `DSTREAM_XMR_WALLET_RPC_PASS` are set and match wallet-rpc.
- `DSTREAM_XMR_SESSION_SECRET` is replaced with a high-entropy secret (not placeholder text).
- Refund policy constants are explicitly set and production-safe:
  - `DSTREAM_XMR_REFUND_MIN_SERVED_BYTES > 0`
  - `DSTREAM_XMR_REFUND_FULL_SERVED_BYTES > DSTREAM_XMR_REFUND_MIN_SERVED_BYTES`
  - `DSTREAM_XMR_REFUND_MAX_RECEIPTS`, `DSTREAM_XMR_REFUND_MAX_RECEIPT_AGE_SEC`, `DSTREAM_XMR_REFUND_MIN_SESSION_AGE_SEC` are tuned for your policy.
- Relay list includes at least two reliable `wss://` relays.

Run:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
ENV_FILE=.env.production npm run harden:deploy
```

## 2) Deploy and runtime verification

Deploy:

```bash
cd /Users/erik/Projects/JRNY
DSTREAM_DEPLOY_PROJECT_DIR=/Users/erik/Projects/JRNY/.dstream-work ./infra/prod/deploy.sh root@your-host
```

If you run deploys from inside `.dstream-work`, `./infra/prod/deploy.sh root@your-host` is a wrapper around the repo-root script and pins `DSTREAM_DEPLOY_PROJECT_DIR` to this workspace automatically.

Verify (single gate command):

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
EXTERNAL_BASE_URL=https://dstream.stream SSH_TARGET=root@your-host npm run gate:prod -- .env.production
```

## 3) Live media acceptance (manual)

Use two devices/networks:

1. Start broadcast from device A.
2. Open watch page from device B (different network if possible).
3. Validate:
   - video starts and stays stable,
   - no repeated WHEP timeout loops,
   - chat send/receive works,
   - stream appears on browse/home cards with preview updates.

## 4) Operational hardening

Runbook: `/Users/erik/Projects/JRNY/.dstream-work/docs/OPS_RUNBOOK.md`

Required:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host npm run ops:ssh:key
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream npm run ops:healthcheck
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream DSTREAM_ALERT_WEBHOOK_URL=https://hooks.example.com/... npm run ops:healthcheck:install
SSH_TARGET=root@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:backup
```

## 5) Mobile release close-out

Run and archive evidence from:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
npm run check:mobile
npm run test:mobile:permissions
```

Then complete `/Users/erik/Projects/JRNY/.dstream-work/docs/MOBILE_RELEASE_CHECKLIST.md`.
