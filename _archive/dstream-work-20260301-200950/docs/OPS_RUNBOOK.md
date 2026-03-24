# Operations Runbook

Last updated: 2026-02-13

This runbook closes the remaining production ops items:

- SSH key auth (no password deploy dependency),
- uptime + alert checks,
- backup + restore policy for env, edge proxy state, and wallet/monero volumes.

## 1) SSH key auth hardening

Install your public key on the server:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host npm run ops:ssh:key
```

Optional hardening (disables password auth after key login is verified):

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
DSTREAM_DISABLE_PASSWORD_AUTH=1 DSTREAM_ALLOW_LOCKOUT_RISK=1 SSH_TARGET=root@your-host npm run ops:ssh:key
```

## 2) Runtime health checks + alerting

Ad-hoc health probe:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream npm run ops:healthcheck
```

With webhook alerting:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream DSTREAM_ALERT_WEBHOOK_URL=https://hooks.example.com/... npm run ops:healthcheck
```

Install remote cron (every 5 minutes by default):

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host DSTREAM_DEPLOY_DOMAIN=dstream.stream DSTREAM_ALERT_WEBHOOK_URL=https://hooks.example.com/... npm run ops:healthcheck:install
```

Override cron schedule:

```bash
DSTREAM_HEALTHCHECK_SCHEDULE="*/2 * * * *" SSH_TARGET=root@your-host npm run ops:healthcheck:install
```

## 3) Backup policy

Create a backup on the server:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
SSH_TARGET=root@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:backup
```

Local/server-side backup options:

- `DSTREAM_BACKUP_ROOT` (default `/opt/dstream/backups` on remote call),
- `DSTREAM_BACKUP_RETENTION_DAYS` (auto-prune older snapshots),
- `DSTREAM_BACKUP_ARCHIVE=1|0` (create `.tgz` bundle or not).

Default backup captures:

- `.env.production`,
- compose files and `infra/prod/Caddyfile`,
- `.caddy-data` + `.caddy-config`,
- Docker volumes matching Monero/wallet/Caddy patterns.

## 4) Restore policy

Restore from backup directory or archive:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
DSTREAM_RESTORE_FORCE=1 SSH_TARGET=root@your-host DSTREAM_REMOTE_DIR=/opt/dstream npm run ops:restore -- /opt/dstream/backups/<timestamp-or-archive>
```

After restore:

```bash
ssh root@your-host 'cd /opt/dstream && docker compose --env-file .env.production up -d --build --remove-orphans'
```

## 5) Production gate (single command)

Run full gate before deploy or go-live:

```bash
cd /Users/erik/Projects/JRNY/.dstream-work
EXTERNAL_BASE_URL=https://dstream.stream SSH_TARGET=root@your-host npm run gate:prod -- .env.production
```

This runs, in order:

1. `harden:deploy`
2. `smoke:external:readiness`
3. `smoke:prod:runtime`
