# Production Hardening Checklist

Last reconciled: 2026-10-03

This checklist applies to the canonical `.dstream-work` deployment.

## Configuration Gate

Run against the populated production file:

```bash
ENV_FILE=.env.production npm run harden:deploy
```

Required boundaries include:

- production relays use `wss://` and are not loopback or placeholder hosts;
- browser-visible STUN configuration contains no credentials;
- TURN URLs and `TURN_SHARED_SECRET` remain server-only;
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` is absent;
- media proxy origins are valid server-side URLs;
- production devtools are disabled;
- session and playback secrets are high entropy and non-placeholder;
- wallet RPC credentials are server-only and non-placeholder;
- mock wallet endpoints are rejected in deploy mode;
- payment intent and settlement stores use persistent storage;
- required payment capability keys match the deployment's public scope.

The current checker also validates settings retained for experimental XMR contribution/refund paths. Those checks protect reachable code; they do not advertise staking or escrow as public launch features.

## Repository Gate

Before release:

```bash
npm run typecheck
npm test
npm run lint
npm run check:mobile
npm run build
```

CI runs these from the canonical `.dstream-work` directory. Desktop packaging is host-platform specific; mobile shell checks do not prove a signed mobile artifact exists.

The root GitHub workflows must also pass:

- `Canonical Runtime CI`
- `Secret Scan`

Do not treat a grep-only secret check as equivalent to the repository Gitleaks job.

## External Surface Gate

```bash
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
```

This verifies required public routes and checks browser assets for local endpoint leakage and expected relay/TURN configuration. Review its exact output before release; a route-only pass is not playback evidence.

## Runtime Gate

```bash
SSH_TARGET=user@your-host DSTREAM_DEPLOY_DOMAIN=your-domain npm run smoke:prod:runtime
```

Confirm separately:

- `/api/payments/capabilities` reports each publicly exposed rail configured;
- `/api/payments/health` reports ready;
- MediaMTX ingest, WHEP, and HLS endpoints are healthy;
- payment and playback-policy data live on persistent storage;
- TURN credentials are short-lived;
- production logs contain no recurring restart, storage, or proxy failures.

## Operational Gate

```bash
SSH_TARGET=user@your-host npm run ops:ssh:key
SSH_TARGET=user@your-host DSTREAM_DEPLOY_DOMAIN=your-domain npm run ops:healthcheck
SSH_TARGET=user@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:backup
```

Install recurring health checks only after verifying the alert destination:

```bash
SSH_TARGET=user@your-host DSTREAM_DEPLOY_DOMAIN=your-domain DSTREAM_ALERT_WEBHOOK_URL=https://hooks.example.com/... npm run ops:healthcheck:install
```

Restore is destructive and remains force-gated:

```bash
DSTREAM_RESTORE_FORCE=1 SSH_TARGET=user@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:restore -- /opt/dstream/backups/<backup>
```

See [`OPS_RUNBOOK.md`](OPS_RUNBOOK.md) for backup contents and restore verification.
