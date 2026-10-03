# dStream Deployment Guide

The production application is the canonical stack in `.dstream-work`. Do not deploy the legacy root workspaces.

## Prepare

```bash
cd .dstream-work
cp .env.production.example .env.production
```

Replace every placeholder and keep the populated file out of Git. In particular:

- public browser values may use `NEXT_PUBLIC_*`,
- secrets and provider credentials must remain in server-only variables,
- TURN uses `TURN_SHARED_SECRET` and short-lived credentials,
- required public payment rails must be listed in `DSTREAM_REQUIRED_PAYMENT_CAPABILITIES`.

Run the production gate described in [CONFIG.md](../CONFIG.md) before deployment.

## Deploy

From the repository root:

```bash
DSTREAM_DEPLOY_PROJECT_DIR="$PWD/.dstream-work" ./infra/prod/deploy.sh user@your-host
```

Or from `.dstream-work` use its wrapper:

```bash
./infra/prod/deploy.sh user@your-host
```

## Verify

A successful command is not sufficient. Verify container health, public routes, payment health, and the behavior that prompted the release.

```bash
cd .dstream-work
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
EXTERNAL_BASE_URL=https://your-domain npm run smoke:prod:runtime
```

The complete, maintained procedure is [.dstream-work/docs/DEPLOYMENT.md](../.dstream-work/docs/DEPLOYMENT.md).
