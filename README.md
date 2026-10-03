# [dStream](https://dstream.stream)

> **Ownerless, Peer-to-Peer, Privacy-Centric Live Streaming.**

dStream is a decentralized streaming protocol that solves deplatforming, platform fees, and reliance on platforms themselves by combining direct cryptocurrency monetization [100% private with no middle-man], **P2P network**, and **Nostr identity** (your unique streamer keys).

[Open dStream](https://dstream.stream) | [Technical documentation](PROTOCOL.md) | [Configuration](CONFIG.md) | [Current features](FEATURES.md)

## Vision

Platforms like Twitch and YouTube own your audience. They can de-platform you, shadow-ban you, take a 50% cut of your revenue, and require massive servers to operate. **dStream is built different.**

- **Direct and private transactions:** Payments happen via cryptocurrency, ensuring privacy when you choose it.
- **Ownership of your unique keys:** Your stream name, bio, and status are stored on the Nostr network, but you own their rights exclusively.
- **No Central Server:** Video segments are distributed via P2P relaying, dramatically reducing infrastructure costs because viewers help redistribute your stream. Theoretically the stream could get clearer with more viewers, while costing the streamer practically nothing.

The current implementation still uses a replaceable media origin to ingest and seed a broadcast. "No Central Server" means dStream does not require one platform-owned identity, discovery, payment, or media provider. Peer assist reduces repeated origin delivery; it does not change the quality encoded by the broadcaster.

## What Ships Today

- Nostr identities, profiles, stream announcements, discovery, chat, presence, moderation, and guilds.
- Browser broadcasting over WHIP and external encoder support for OBS-compatible RTMP/WHIP workflows.
- WHEP playback with HLS fallback, recovery controls, and optional WebRTC viewer assist.
- Direct, noncustodial creator payments. The public dstream.stream deployment currently exposes verified Monero, Bitcoin Lightning, and Bitcoin on-chain rails.
- Additional verified settlement adapters for EVM assets, TRON, Solana, XRP Ledger, Dogecoin, Bitcoin Cash, and Cardano when a node operator configures the required RPC or indexer services.
- Self-hosted Docker services, short-lived TURN credentials, health checks, backups, and production gates.

See [FEATURES.md](FEATURES.md) for the distinction between production-active, configuration-dependent, and experimental functionality. Privacy depends on the selected payment network: Monero is private by default; Bitcoin and most other public ledgers are not.

## Quick Start

The deployed application lives in `.dstream-work`. The older root workspaces remain only as legacy reference.

```bash
git clone https://github.com/3KD/dStream.git
cd dStream/.dstream-work
cp .env.example .env.local
npm ci
npm run infra:up:test
npm run dev
```

Open `http://localhost:5656`. For the all-in-one Docker stack, use `npm run stack:up` instead of the last two commands.

Before deploying, read [CONFIG.md](CONFIG.md) and [.dstream-work/docs/DEPLOYMENT.md](.dstream-work/docs/DEPLOYMENT.md). Do not put credentials in any `NEXT_PUBLIC_*` variable or commit a populated environment file.

## Repository Map

| Path | Purpose |
| --- | --- |
| `.dstream-work/apps/web` | Canonical Next.js web application deployed to dstream.stream |
| `.dstream-work/packages/protocol` | Canonical Nostr event builders, parsers, and validation |
| `.dstream-work/services` | Manifest and transcoding services |
| `.dstream-work/infra` | MediaMTX, TURN, relay, and production infrastructure |
| `.dstream-work/docs` | Operator, deployment, mobile, and protocol decision records |
| `apps`, `infra`, `services`, root `package.json` | Legacy pre-rebuild tree; not the production source |
| `docs/adr` | Historical ADR set for the pre-rebuild tree |

The documentation index is [docs/README.md](docs/README.md). The implemented protocol is defined by [PROTOCOL.md](PROTOCOL.md) and `.dstream-work/packages/protocol`, not by historical planning files.

## Verification

From `.dstream-work`:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Production payment readiness is observable at [`/api/payments/capabilities`](https://dstream.stream/api/payments/capabilities). A rail is not active merely because an adapter exists in the source tree.

---

*Built today for the creators of tomorrow.*
