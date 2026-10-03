# dStream Architecture

This is the architecture of the canonical `.dstream-work` runtime deployed to dstream.stream. The root-level `apps`, `infra`, and `services` directories are the pre-rebuild implementation and are retained only as legacy reference.

## System Boundaries

```text
Broadcaster
  browser WHIP or external encoder RTMP/WHIP
                 |
                 v
        MediaMTX origin/seed
          |             |
        WHEP           HLS -----------+
          |             |             |
          v             v             v
        viewer <---- origin fallback  peer assist

Nostr relays: identity, profiles, announcements, chat, presence,
              moderation, guilds, reports, and P2P signaling

Payment verifiers: wallet RPC, chain RPC, or indexer selected by rail
```

The control plane is replaceable and relay-based. The media plane still needs an origin to ingest and seed a broadcast. Viewer assist can reduce repeated origin delivery after peers connect, but it is not a substitute for initial origin availability.

## Runtime Planes

### Identity and coordination

- Nostr secp256k1 identities are user-controlled and represented as `npub` in the UI.
- Kind `30311` announcements identify streams by `(pubkeyHex, streamId)`.
- Relays carry profiles, chat, presence, moderation, guild, report, and P2P signaling events.
- The discovery snapshot is an application cache of relay state, not an authoritative registry. Direct relay events newer than a snapshot remain authoritative for their own state.

### Media

- Browser Broadcast Studio publishes over WHIP.
- External encoders can publish through the RTMP settings shown by Broadcast Studio, or WHIP when supported.
- MediaMTX exposes WHEP and HLS outputs.
- The watch player uses WHEP where viable and HLS as the compatibility and recovery path.
- Optional transcoding creates additional HLS renditions on a host sized for encoding.

### Viewer assist

- Nostr kind `8108` exchanges WebRTC signaling.
- Browser data channels transfer requested HLS bytes between viewers.
- Host policy can disable assist or bound the active peer set.
- The origin remains the bootstrap and fallback path, and unverified peer bytes must not outrank verified origin/manifest data.

### Payments

- Creators advertise noncustodial destinations in profile and stream metadata.
- The web app creates purpose-bound payment intents and stores settlement records on persistent server storage.
- A server-side verifier checks the selected chain, wallet RPC, or indexer before paid access is granted.
- dstream.stream publicly enables XMR, BTC Lightning, and BTC on-chain. Other adapters require explicit operator configuration and exposure.

## Deployed Services

| Service | Responsibility |
| --- | --- |
| `web` | Next.js UI, server routes, proxying, discovery cache, payment orchestration |
| `mediamtx` | WHIP/RTMP ingest, WHEP playback, HLS origin |
| `turn` | NAT traversal using short-lived credentials |
| `relay` | Optional node-local Nostr relay |
| `manifest` | Optional segment hashing and manifest publication support |
| `xmr-wallet-rpc` | Monero verified payment sessions when configured |
| `transcoder` | Optional derived rendition ladder |

The Compose stack also includes initialization jobs and persistent volumes for wallet, payment, and playback-policy state.

## Request Flows

### Go live

1. The broadcaster selects an identity and stream ID.
2. Browser WHIP or an external encoder publishes media to the origin.
3. Broadcast Studio confirms media detection.
4. The broadcaster signs and publishes a kind `30311` event with `status=live`.
5. Discovery clients merge direct relay events with a timestamped server snapshot.

### Watch

1. The route resolves `npub` to the canonical hex key and fetches the matching announcement.
2. The player resolves media hints and probes the preferred path.
3. WHEP is attempted when usable; HLS provides fallback and recovery.
4. Optional peer assist starts only when policy and browser connectivity allow it.
5. Chat and presence subscriptions use the stream `a` tag.

### Pay

1. The creator advertises an asset, network, and destination.
2. The viewer opens a wallet URI or payment workflow.
3. The application creates a bound intent before protected access is granted.
4. The configured verifier checks settlement and confirmation policy.
5. The durable intent is consumed once; an unavailable verifier fails closed.

## Trust Boundaries

- Nostr signatures prove control of a key, not the truth of arbitrary metadata.
- A relay may omit, delay, or reject events; clients use multiple relays and preserve event timestamps.
- A media origin can fail or serve malformed content; player recovery cannot repair bytes that were already damaged upstream.
- Presence and peer contribution are advisory measurements unless separately verified.
- dStream is noncustodial. It does not hold wallet seeds or private keys.
- Public blockchains expose transaction data. Privacy claims must be specific to the selected rail.
- Operator moderation affects official indexed surfaces; it does not delete third-party relay history.

## Repository Structure

```text
.dstream-work/
  apps/web/                 canonical web app and API routes
  apps/mobile/              Capacitor shell
  apps/desktop/             Electron shell
  packages/protocol/        event schemas, builders, parsers, tests
  services/                 manifest and transcoder services
  infra/                    media, relay, TURN, and deployment configuration
  docs/                     operations and accepted architecture records

apps/, infra/, services/    legacy pre-rebuild implementation
docs/adr/                   legacy ADR set
```

See [PROTOCOL.md](PROTOCOL.md), [CONFIG.md](CONFIG.md), and [docs/README.md](docs/README.md) for the public source-of-truth set.
