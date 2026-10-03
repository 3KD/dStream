# dStream Feature Status

Last verified against the canonical `.dstream-work` source and the public dstream.stream capability endpoints on 2026-10-03.

## Status Labels

- **Production:** present in the deployed application and backed by a production route or service.
- **Implemented, configuration-dependent:** complete code path whose availability depends on node configuration, an RPC/indexer, hardware, or a broadcaster setting.
- **Experimental:** present in code but not part of the public launch promise.
- **Legacy:** retained in the old root application for reference and not deployed.

## Production on dstream.stream

### Broadcasting and playback

- **Production:** Browser camera, microphone, and screen capture in Broadcast Studio.
- **Production:** WHIP publishing with reconnect handling.
- **Production:** OBS and other external encoder setup through RTMP, with a WHIP endpoint available for compatible clients.
- **Production:** WHEP playback with HLS fallback and explicit loading, retry, and error states.
- **Production:** Live-edge correction, playlist recovery, rendition selection when announced, captions, fullscreen, picture-in-picture, and volume controls.
- **Production:** Public and allowlisted private stream announcements.
- **Implemented, configuration-dependent:** Optional server-side transcoding ladder; disabled unless a suitable encoding host enables the Compose profile.

### Discovery and identity

- **Production:** Nostr key generation, import/export, NIP-07 extension signing, and `npub` routes.
- **Production:** Kind `0` profiles, NIP-05 badges/policy, follows, aliases, and local trust/block controls.
- **Production:** Kind `30311` live announcements, relay discovery, server snapshot fallback, search, topics, content warnings, and operator discovery moderation.
- **Production:** Home and browse thumbnails prefer announced images and can sample a live HLS frame when no usable image is available.

### Chat and communities

- **Production:** Stream-scoped kind `1311` chat, with compatibility reads for older kind `1` messages.
- **Production:** Presence, viewer estimates, custom emotes, slow mode, follower/subscriber policies, moderation actions, and moderator roles.
- **Production:** NIP-04 kind `4` direct messages and stream whispers.
- **Production:** Guild creation, membership, roles, and featured streams.
- **Production:** Signed abuse reports and operator review actions for official discovery surfaces.

### Payments

- **Production:** Noncustodial payment methods advertised by creators through stream announcements and profiles.
- **Production:** Bound payment intents, durable settlement records, and fail-closed verifier readiness.
- **Production:** Verified Monero payments through wallet RPC.
- **Production:** Verified Bitcoin Lightning settlement.
- **Production:** Verified Bitcoin on-chain settlement through an Esplora quorum or configured node RPC.
- **Production:** dstream.stream payment health currently requires `btc:lightning`, `btc:utxo`, and `xmr:xmr`; all three report ready.

### Operations and security

- **Production:** Docker Compose stack for web, MediaMTX, TURN, relay, manifest service, and optional transcoder.
- **Production:** Short-lived TURN credentials issued from a server-only shared secret.
- **Production:** Persistent payment, playback-policy, and wallet state with backup and health checks.
- **Production:** Deployment preflight, runtime smoke tests, production gates, secret scanning, and generated-artifact exclusions.

## Implemented, Configuration-Dependent

- WebRTC viewer assist uses Nostr kind `8108` signaling and browser data channels to share HLS bytes. It reduces repeated origin delivery when compatible peers connect; the origin remains the bootstrap and fallback path.
- Manifest kind `30313` can publish signed SHA-256 segment metadata, and the player has verification/tamper states. A node must run and configure the manifest service for this path to be active.
- Verified adapters exist for DOGE, BCH, ETH, ERC-20 USDT/USDC/PEPE, TRX/TRC-20 USDT, SOL/SPL USDC/USDT, XRP, and ADA. They remain inactive until the operator configures the corresponding RPC/indexer and deliberately exposes the asset.
- Video archive, upload, catalog, access package, and analytics routes exist for operator-managed video libraries. Storage and processing capacity are node responsibilities.
- Capacitor mobile and Electron desktop shells exist, but a source package is not evidence that a signed store/release artifact has been published.

## Experimental, Not a Launch Claim

- Stake-gated peer participation, contribution receipts, refund policy, and multisig coordination remain experimental. They are not advertised as trustless staking or trustless escrow.
- Viewer-assist incentives are not a mature autonomous reward market.
- P2P assist does not raise the broadcaster's encoded resolution or bitrate. It can improve delivery resilience and reduce origin bandwidth only when peers successfully exchange the requested media bytes.

## Legacy Tree

The root `apps`, `infra`, `services`, `package.json`, `BUILD_PATH.md` history, and `docs/adr` describe the pre-rebuild implementation. They are not the source for dstream.stream. The deployed app, current protocol package, tests, and deployment tooling live under `.dstream-work`.

## Evidence and Checks

```bash
cd .dstream-work
npm run typecheck
npm test
npm run lint
npm run build
```

Runtime state:

- `https://dstream.stream/api/payments/capabilities`
- `https://dstream.stream/api/payments/health`

The protocol event inventory is documented in [PROTOCOL.md](PROTOCOL.md). Configuration and activation requirements are documented in [CONFIG.md](CONFIG.md).
