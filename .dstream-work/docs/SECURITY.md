# Security Operations

## Releases

Run `npm run security:audit`, typechecking, tests and lint before building. The audit gate fails closed on registry/report errors, unreviewed web high/critical advisories and any workspace critical advisory. It is not a penetration test or proof of correct payment authorization.

The sole time-limited web high-advisory disposition is GHSA-3gc7-fjrx-p6mg, expiring November 14, 2026. The Solana SDK is imported only inside the client-only Phantom send function after a browser/provider check. `bigint-buffer` maps its Node entry to a separate browser implementation with no native addon. The web server settlement adapters do not import either Solana SDK. The gate rejects SDK imports in API/settlement-server directories and checks the client boundary. Review or remove the exception before expiry; adding a server-side SDK consumer invalidates it. Moderate and development-only high findings are not hidden by the gate. Native release QA remains separate from deploying the website.

## Media Authorization

Set `DSTREAM_MEDIA_AUTH_SECRET` to a separate random value of at least 32 characters, server-only, on both web and MediaMTX. Compose configures MediaMTX HTTP authorization against the web callback. Never put this secret in a public variable or URL shown to a viewer.

The existing manifest and transcoder services use distinct `DSTREAM_MEDIA_MANIFEST_SECRET` and `DSTREAM_MEDIA_TRANSCODER_SECRET` values. Their credentials are path/action-bound and expire: manifest credentials can read but cannot publish; transcoder credentials can read and publish only derived `__r360p`-style rendition paths, never the creator's base path. Do not share either service secret with a viewer. Control API authentication remains loopback-only; it is not excluded from HTTP authorization.

Studio obtains a scoped publish credential using the creator's signed, body-bound request. Copy the new stream key into OBS after upgrading; the old pubkey/path alone is no longer a publish credential. Credentials expire after 36 hours and are checked at connection time. Existing connections are not an identity credential for future publishes. A reader token cannot be used to publish.

HLS/WebRTC aliases go through the same application permissions, and MediaMTX enforces permissions for direct protocol connections. Unknown policies fail closed. Private policies are retained rather than becoming public when a cache TTL passes. Register the signed stream policy before allowing viewers to connect. All media services must stay on the private container network except the documented ingest/ICE ports. A deliberate infrastructure migration must not stop an active broadcast without coordination.

## Wallet Operations

Advanced multisig escrow is unavailable in production: it must not convert or sign with the ordinary donation wallet. Enabling a real production escrow service requires an isolated wallet and a separately reviewed authorization/provisioning boundary. The development mock flow is not certification of a production wallet.

Stake withdrawals verify the wallet's persisted subaddress label before accessing funds. Withdrawal/refund requests bind their signed authorization to the exact payload. A durable claim in `DSTREAM_XMR_SETTLEMENT_STORE_PATH` (default `/var/lib/dstream/wallet-settlements.json`) prevents competing sweeps and retries after ambiguous timeouts. Do not delete pending claims automatically. An operator must compare outgoing wallet transactions and reconcile the result before repairing an uncertain claim.

Public wallet capability probes are read-only. A skipped spending method is reported as uncertified, not assumed supported. Do not use active probes on the production donation wallet. Wallet-RPC credentials remain server-side; a future spending service must remove spending authority from the general web process, not merely rename an environment variable.

## Storage And Runtime

The web image runs as UID 1000 with a read-only root filesystem, dropped capabilities and bounded memory/PIDs. Existing data volumes must be owned by UID/GID 1000 before upgrading; preserve their contents. Only the data volume, temporary directory and Next image cache are writable. The recording mount remains read-only unless the operator explicitly provisions writable upload storage.

Uploads require writable recording storage, bounded chunks, an authenticated upload session, reserved capacity and free-disk headroom. Defaults reserve at most 1 GiB across eight sessions, at most two sessions per host, with 256 MiB free headroom. Configure `DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES` and `DSTREAM_VIDEO_UPLOAD_MIN_FREE_BYTES` for a larger node. Keep the reverse proxy request limit above the 4 MiB chunk size; the production Caddyfile uses 8 MB. The legacy single-request upload API requires a request-bound Nostr authorization header over the raw multipart body; large files use resumable uploads.

TURN credentials are short-lived with bounded issuance. The final forwarded-for hop is trusted only behind the managed reverse proxy; do not expose the web port directly. Coturn allocation quotas remain necessary in addition to HTTP issuance limits. Public watching does not require payment or a persistent identity.

## Browser Keys And Incidents

The baseline CSP restricts objects, base URLs and framing without changing static rendering. It is not a strict script policy and does not solve same-origin compromise. Local Nostr keys and remembered NWC secrets remain sensitive browser storage. Prefer extension/remote signers and narrowly authorized wallet connections. An encrypted local-vault migration requires explicit owner consent and must not erase existing identities or transfer their keys to a server.

Security patches do not establish whether a past intrusion occurred. Preserve retained logs, review wallet outgoing transfers, and decide credential/key rotation from actual exposure evidence. Never post private keys, wallet seeds, RPC passwords or deployment secrets in an issue or public report.
