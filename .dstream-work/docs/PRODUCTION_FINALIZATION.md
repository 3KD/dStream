# Production Release Acceptance

Last reconciled: 2026-10-03

This checklist defines evidence required for a web production release. It does not declare mobile store readiness or prove every third-party relay, source stream, wallet, or network will remain available.

## Source and Documentation

- [ ] The release commit is pushed to the intended GitHub branch.
- [ ] `README.md`, `FEATURES.md`, `PROTOCOL.md`, `CONFIG.md`, and `ARCHITECTURE.md` match the release behavior.
- [ ] Historical planning documents are clearly labeled and do not override the public source of truth.
- [ ] `Canonical Runtime CI` passes for the release commit.
- [ ] `Secret Scan` passes for the release commit.

## Local Gates

From `.dstream-work`:

```bash
npm run typecheck
npm test
npm run lint
npm run check:mobile
npm run build
ENV_FILE=.env.production npm run harden:deploy
```

Record warnings separately. A successful exit code does not convert warnings or skipped external dependencies into verified behavior.

## Deploy and Runtime Gates

```bash
cd /path/to/dStream
DSTREAM_DEPLOY_PROJECT_DIR="$PWD/.dstream-work" ./infra/prod/deploy.sh user@your-host
```

Then run:

```bash
cd /path/to/dStream/.dstream-work
EXTERNAL_BASE_URL=https://your-domain SSH_TARGET=user@your-host npm run gate:prod -- .env.production
```

Record the deployed commit, container status, route results, and payment capability response.

## Live Media Acceptance

Use a real source and two clients, preferably on different networks:

1. Start browser or OBS ingest and record the time until media detection.
2. Confirm the signed kind `30311` announcement reaches multiple relays.
3. Load a fresh Browse page and confirm the stream appears under Live Now.
4. Open the direct watch route and record startup time and selected transport.
5. Watch long enough to detect startup stalls, repeated fallback, segment loops, or live-edge drift.
6. Test chat send/receive and background/lock behavior on the relevant mobile device when that behavior changed.
7. End the stream and confirm discovery transitions to ended/offline without relying on a stale snapshot.

Automated tests and synthetic media do not replace this pass when playback behavior changed.

## Payments

- [ ] `/api/payments/capabilities` reports only deliberately exposed assets.
- [ ] `/api/payments/health` reports ready for every required public capability.
- [ ] XMR, BTC Lightning, and BTC on-chain settlement are tested with the production verifier path when any related code or configuration changed.
- [ ] No wallet seed, private key, RPC password, provider key, or session secret appears in browser assets or Git history.

## Operations

- [ ] Key-based SSH access is verified.
- [ ] Health checks and alert delivery are verified.
- [ ] A current backup completes and names the captured persistent volumes.
- [ ] Restore procedure and responsible operator are documented.
- [ ] Disk headroom and container restart state are reviewed after deploy.

## Mobile Boundary

Mobile source-shell checks are part of repository CI, but mobile release acceptance is separate. Do not claim a signed or store-ready mobile release until generated native projects, signing, real-device tests, uploads, and store state are verified using [`MOBILE_RELEASE_CHECKLIST.md`](MOBILE_RELEASE_CHECKLIST.md).
