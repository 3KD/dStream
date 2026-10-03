# dStream Configuration

This document describes the canonical runtime in `.dstream-work`. The root-level legacy app has a different configuration model and is not deployed to dstream.stream.

## Configuration Files

| File | Purpose | Commit it? |
| --- | --- | --- |
| `.dstream-work/.env.example` | Safe local-development template | Yes |
| `.dstream-work/.env.production.example` | Production template with placeholders and public defaults | Yes |
| `.dstream-work/.env.local` | Local values and credentials | No |
| `.dstream-work/.env.production` | Production values and credentials | No |

Copy a template, then replace values locally:

```bash
cd .dstream-work
cp .env.example .env.local
```

All `.env*` files are ignored except the two templates. Public wallet addresses are not secrets; wallet seeds, private keys, RPC passwords, API keys, session secrets, and TURN shared secrets are.

## Browser-Visible Settings

Every `NEXT_PUBLIC_*` value is compiled into browser JavaScript. Never put a password, API key, wallet seed, private key, permanent TURN credential, or private endpoint token in one.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_NOSTR_RELAYS` | Comma-separated `wss://` relays used for discovery and events |
| `NEXT_PUBLIC_HLS_ORIGIN` | Public base URL announced for media playback |
| `NEXT_PUBLIC_RTMP_INGEST_ORIGIN` | Public RTMP endpoint shown to external encoders |
| `NEXT_PUBLIC_WEBRTC_STUN_SERVERS` | Public STUN URLs only; no credentials |
| `NEXT_PUBLIC_NIP05_POLICY` | `off`, `badge`, or `require` identity policy |
| `NEXT_PUBLIC_DSTREAM_PAYMENT_ASSETS` | Assets exposed in public payment UI |
| `NEXT_PUBLIC_SUPPORT_*_ADDRESS` | Public donation destinations |
| `NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING` | Public Lightning address, LNURL, or invoice destination |

The retired `NEXT_PUBLIC_WEBRTC_ICE_SERVERS` setting must not be used because it can expose permanent TURN credentials in the client bundle.

## Server-Only Runtime

| Group | Important variables |
| --- | --- |
| Media proxy | `DSTREAM_WHIP_PROXY_ORIGIN`, `DSTREAM_WHEP_PROXY_ORIGIN`, `DSTREAM_HLS_PROXY_ORIGIN` |
| Private playback | `DSTREAM_PLAYBACK_ACCESS_SECRET`, `DSTREAM_PLAYBACK_POLICY_STORE_PATH` |
| TURN | `DSTREAM_TURN_URLS`, `DSTREAM_TURN_CREDENTIAL_TTL_SEC`, `TURN_SHARED_SECRET`, `TURN_EXTERNAL_IP`, relay port range and quotas |
| Monero | `DSTREAM_XMR_WALLET_RPC_ORIGIN`, RPC credentials, daemon settings, `DSTREAM_XMR_SESSION_SECRET` |
| Payment storage | `DSTREAM_PAYMENT_INTENT_STORE_PATH`, `DSTREAM_PAYMENT_SETTLEMENT_STORE_PATH` |
| Payment readiness | `DSTREAM_PUBLIC_PAYMENT_ASSETS`, `DSTREAM_REQUIRED_PAYMENT_CAPABILITIES` |
| Other rails | `DSTREAM_BTC_*`, `DSTREAM_DOGE_*`, `DSTREAM_BCH_*`, `DSTREAM_ETH_*`, `DSTREAM_TRON_*`, `DSTREAM_SOLANA_*`, `DSTREAM_XRPL_*`, `DSTREAM_CARDANO_*` |

TURN credentials are issued by `/api/webrtc/ice-servers` from a server-only shared secret and expire after the configured TTL.

## Payment Rail States

The source tree implements these verifier families:

| Rail | Assets | Operator dependency |
| --- | --- | --- |
| Monero wallet RPC | XMR | Monero wallet RPC and daemon |
| Lightning / NIP-57 | BTC | Reachable LNURL or NIP-57 settlement source |
| UTXO | BTC, DOGE, BCH | Node RPC or supported indexer |
| EVM | ETH, USDT, USDC, PEPE | JSON-RPC and token allowlist |
| TRON | TRX, USDT | TRON HTTP API |
| Solana | SOL, USDC, USDT | Solana JSON-RPC and mint allowlist |
| XRP Ledger | XRP | XRPL JSON-RPC |
| Cardano | ADA | Blockfrost or Koios-compatible indexer |

Implementation does not mean deployment. A verifier is active only when `/api/payments/capabilities` reports `configured: true`, and a public deployment should expose only assets listed in its public configuration. dstream.stream currently requires and reports ready `btc:lightning`, `btc:utxo`, and `xmr:xmr`.

## Default Ports

| Service | Default |
| --- | ---: |
| Web | `5656` |
| RTMP ingest | `1940` on the host |
| MediaMTX WebRTC/WHIP/WHEP | `8889` internally |
| MediaMTX HLS | `8888` internally |
| TURN | `3478` plus configured relay range |
| Local Nostr relay | `8081` |

Treat these as Compose defaults, not protocol constants. HLS segment duration and rendition policy are controlled by the media pipeline and are not fixed by the dStream protocol.

## Production Validation

Run from `.dstream-work` with a populated production file:

```bash
npm run harden:deploy -- .env.production
EXTERNAL_BASE_URL=https://your-domain npm run smoke:external:readiness
SSH_TARGET=user@your-host DSTREAM_DEPLOY_DOMAIN=your-domain npm run smoke:prod:runtime
EXTERNAL_BASE_URL=https://your-domain SSH_TARGET=user@your-host npm run gate:prod -- .env.production
```

The hardening check rejects placeholder production values, public credential leakage, missing required secrets, and inactive required payment capabilities. See [.dstream-work/docs/DEPLOYMENT.md](.dstream-work/docs/DEPLOYMENT.md) for the complete deployment flow.
