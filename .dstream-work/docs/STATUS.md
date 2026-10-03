# dStream Runtime Status

Last reconciled with the canonical source and public production capability endpoints on 2026-10-03.

## Canonical Runtime

- Source: `.dstream-work`
- Public site: `https://dstream.stream`
- Legacy root workspaces: retained for reference, not deployed
- Public source-of-truth feature matrix: `../../FEATURES.md`
- Wire protocol reference: `../../PROTOCOL.md`

## Production Surface

- Browser and external-encoder broadcasting
- Nostr stream announcements, discovery, profiles, chat, presence, moderation, and guilds
- WHEP playback with HLS fallback
- Optional WebRTC viewer assist with origin fallback
- Public verified payment capabilities: Monero, Bitcoin Lightning, and Bitcoin on-chain
- Deployment hardening, health checks, backups, and short-lived TURN credentials

## Configuration-Dependent Surface

- Additional payment verifier adapters
- Manifest-based segment verification
- Optional transcoding ladder
- Operator-managed video library processing
- Mobile and desktop release packaging

## Not a Public Launch Claim

- Trustless staking
- Trustless escrow
- Autonomous peer-reward economics
- Fully originless live ingest or playback
- P2P increasing the broadcaster's encoded picture quality

Runtime payment state is available from `/api/payments/capabilities` and `/api/payments/health`. Passing source tests does not by itself verify production playback, broadcast, mobile, or external payment-provider behavior.
