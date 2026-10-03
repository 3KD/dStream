# dStream Development Path

This replaces the pre-rebuild 200-item construction checklist. The canonical application already exists under `.dstream-work`; new work should extend and verify that runtime rather than rebuild the legacy root app.

## 1. Establish the Boundary

Before changing code, identify the affected plane:

- Nostr events and validation: `.dstream-work/packages/protocol`
- Web UI and server routes: `.dstream-work/apps/web`
- Media behavior: `.dstream-work/apps/web/src/components/Player.tsx`, media helpers, and `.dstream-work/infra`
- Payments: `.dstream-work/apps/web/src/lib/payments` and payment API routes
- Deployment and operations: `.dstream-work/infra`, scripts, and operator docs

Do not implement production changes in the root legacy `apps`, `infra`, or `services` tree.

## 2. Reproduce the User-Visible Behavior

Use the affected browser, viewport, source stream, and production/local environment. Configuration checks and unit tests do not replace a playback, broadcast, payment, or mobile behavior test when that behavior is the request.

Record:

- exact route and stream identity,
- browser/device and orientation,
- media source and transport selected,
- timestamps for startup, stalls, fallback, and recovery,
- browser console and server logs,
- whether the problem is upstream, origin, relay, application, or client specific.

## 3. Make the Narrowest Correct Change

Preserve the protocol and deployment boundaries in [ARCHITECTURE.md](ARCHITECTURE.md). Update [PROTOCOL.md](PROTOCOL.md), [CONFIG.md](CONFIG.md), or [FEATURES.md](FEATURES.md) in the same change when behavior or public support status changes.

## 4. Verify

From `.dstream-work`:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Run focused browser/layout/smoke tests for the changed surface. Production-dependent work must also use the external readiness/runtime checks described in [CONFIG.md](CONFIG.md).

## 5. Release

A local pass is not a production result. After deployment, verify the public route, expected asset version, runtime health, and the original user-visible behavior. Report local, deployed, and externally verified states separately.

The current document map is [docs/README.md](docs/README.md).
