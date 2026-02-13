# Production Finalization Checklist

This is the close-out checklist for calling dStream production complete.

## 1) Secrets and endpoints (must be real)

- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` uses real STUN/TURN infrastructure (no `turn.example.com`).
- `DSTREAM_XMR_WALLET_RPC_ORIGIN` points to a real wallet RPC service (not `xmr-mock`).
- `DSTREAM_XMR_WALLET_RPC_USER` and `DSTREAM_XMR_WALLET_RPC_PASS` are set and match wallet-rpc.
- `DSTREAM_XMR_SESSION_SECRET` is replaced with a high-entropy secret (not placeholder text).
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

Verify:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
EXTERNAL_BASE_URL=https://dstream.stream npm run smoke:external:readiness
SSH_TARGET=root@your-host npm run smoke:prod:runtime
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

- Switch deploy access from password SSH to key-based SSH.
- Add uptime checks and alerting for:
  - `https://dstream.stream/`
  - `https://dstream.stream/broadcast`
  - relay endpoint availability
  - MediaMTX health (`/v3/paths/list`)
- Add backup policy for:
  - `.env.production` (encrypted backup),
  - wallet state/keys,
  - Caddy data (`/data`) and config.

## 5) Mobile release close-out

Run and archive evidence from:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
npm run check:mobile
npm run test:mobile:permissions
```

Then complete `/Users/erik/Projects/JRNY/.dstream-work/docs/MOBILE_RELEASE_CHECKLIST.md`.
