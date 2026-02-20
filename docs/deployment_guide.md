# dStream Production Deployment Guide (Current Stack)

This guide targets the current rebuild stack in `/.dstream-work` (root `docker-compose.yml`), not the legacy `infra/prod/docker-compose.prod.yml` layout.

## 1) Prerequisites

- A Linux VPS with Docker + Docker Compose plugin installed.
- DNS pointed to your server (for example `dstream.stream`).
- A completed production env file:
  - `.dstream-work/.env.production` (copy from `.env.production.example` and fill real values).

## 2) Required production env values

At minimum, set these in `.dstream-work/.env.production`:

- `NEXT_PUBLIC_NOSTR_RELAYS` (2+ public `wss://` relays)
- `NEXT_PUBLIC_HLS_ORIGIN` (`https://<your-domain>`)
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` (must include at least one `turn:`/`turns:` server)
- `DSTREAM_DEVTOOLS=0`
- `DSTREAM_XMR_SESSION_SECRET` (32+ chars)

## 3) Deploy with push script

From this repo:

```bash
./infra/prod/deploy.sh user@your-server
```

Defaults:

- Local project dir: `./.dstream-work`
- Remote dir: `/opt/dstream`
- Compose stack: `docker-compose.yml`

Optional flags via env vars:

```bash
# Deploy a different local checkout
DSTREAM_DEPLOY_PROJECT_DIR=/abs/path/to/dstream ./infra/prod/deploy.sh user@your-server

# Deploy to different remote directory
DSTREAM_DEPLOY_REMOTE_DIR=/srv/dstream ./infra/prod/deploy.sh user@your-server

# Include real-wallet compose overlay
DSTREAM_DEPLOY_REAL_WALLET=1 ./infra/prod/deploy.sh user@your-server

# Override network/domain/caddy container names (if needed)
DSTREAM_DEPLOY_NETWORK=dstream_default DSTREAM_DEPLOY_DOMAIN=stream.example.com ./infra/prod/deploy.sh user@your-server

# Disable self-healing/reachability checks
DSTREAM_DEPLOY_SELF_HEAL=0 DSTREAM_DEPLOY_HEALTHCHECK=0 ./infra/prod/deploy.sh user@your-server
```

By default, `deploy.sh` now:

- Recreates `dStream_caddy` on the target host with `/opt/dstream/infra/prod/Caddyfile`.
- Reattaches it to the app network (`dstream_default` by default).
- Runs post-deploy probes for:
  - `http://127.0.0.1:5656/settings`
  - `https://<domain>/`, `/browse`, `/broadcast`, `/settings` (via local `--resolve`).

## 4) Verify after deploy

```bash
ssh user@your-server 'cd /opt/dstream && docker compose --env-file .env.production ps'
ssh user@your-server 'cd /opt/dstream && docker compose --env-file .env.production logs --since 5m web'
```

If the app is publicly reachable, run local gates against the domain:

```bash
cd .dstream-work
ENV_FILE=.env.production npm run harden:deploy
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
```

## 5) Notes

- The legacy files in `infra/prod/docker-compose.prod.yml` and `infra/prod/Caddyfile` are historical and do not define the current runtime stack.
