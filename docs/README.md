# dStream Documentation Map

The canonical deployed source is `.dstream-work`. The repository root also contains an older implementation retained for historical comparison; it is not built or deployed to dstream.stream.

## Public Source of Truth

- [README](../README.md): product overview, quick start, and repository map.
- [FEATURES](../FEATURES.md): production-active, configuration-dependent, experimental, and legacy status.
- [PROTOCOL](../PROTOCOL.md): implemented Nostr event and media/payment protocol.
- [CONFIG](../CONFIG.md): environment variables, secrets boundary, ports, and rail activation.
- [ARCHITECTURE](../ARCHITECTURE.md): runtime planes, services, flows, and trust boundaries.
- [BUILD_PATH](../BUILD_PATH.md): current contribution and verification workflow.

## Operator Documentation

- [Canonical runtime README](../.dstream-work/README.md)
- [Deployment](../.dstream-work/docs/DEPLOYMENT.md)
- [Hardening](../.dstream-work/docs/HARDENING.md)
- [Operations runbook](../.dstream-work/docs/OPS_RUNBOOK.md)
- [Production finalization](../.dstream-work/docs/PRODUCTION_FINALIZATION.md)
- [Wallet certification](../.dstream-work/docs/WALLET_CERTIFICATION.md)
- [Mobile app](../.dstream-work/docs/MOBILE_APP.md)
- [Mobile release checklist](../.dstream-work/docs/MOBILE_RELEASE_CHECKLIST.md)

## Protocol Decisions

Accepted ADRs for the current runtime live in `.dstream-work/docs/adr`. They record design decisions and may describe historical alternatives; [PROTOCOL.md](../PROTOCOL.md) and tested source code define current wire behavior.

## Historical Material

- `docs/adr`: pre-rebuild ADRs.
- `apps`, `infra`, `services`: pre-rebuild implementation.
- `docs/JRNY_DSTREAM_PARITY.md`: archived migration pointer.

Historical files must not be used as current setup, deployment, feature-status, or protocol instructions.
