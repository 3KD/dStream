# dStream Protocol Reference

This document describes the protocol implemented by `.dstream-work/packages/protocol` and the deployed web application. It replaces the earlier WebTorrent/Ed25519 draft.

## Scope

dStream separates four concerns:

1. **Identity and coordination:** signed Nostr events on replaceable relays.
2. **Media:** WHIP or RTMP ingest to a replaceable origin, WHEP playback when available, and HLS fallback.
3. **Viewer assist:** Nostr-signaled WebRTC data channels that can exchange requested HLS bytes.
4. **Value transfer:** noncustodial wallet destinations plus server-side settlement verification when a rail is configured.

An origin is required to ingest and seed live media. Nostr relays and media origins are hints and transport providers, not owners of a creator's identity.

## Identity and Cryptography

- Nostr public keys are 32-byte secp256k1 x-only keys represented internally as 64 lowercase hexadecimal characters.
- User-facing keys use NIP-19 `npub` encoding.
- Events use the standard Nostr event ID and BIP-340 Schnorr signature model provided by `nostr-tools`.
- The canonical stream identity is `(streamPubkey, streamId)`.
- `streamId` must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/`.
- A stream address tag is `30311:<streamPubkey>:<streamId>`.
- Manifest segment digests use SHA-256.

dStream does not use Ed25519 for Nostr identity or event signatures.

## Event Kinds

| Kind | Name | Scope |
| ---: | --- | --- |
| `30311` | Stream announcement | Parameterized replaceable live metadata and media hints |
| `1311` | Stream chat | Public message scoped by stream `a` tag |
| `30312` | Presence | Viewer heartbeat scoped by stream `a` tag |
| `8108` | P2P signaling | Offer, answer, ICE candidate, and session control envelope |
| `30313` | Manifest root | Signed rendition epoch and SHA-256 segment metadata |
| `30314` | XMR receipt | Signed verified Monero observation |
| `30315` | Guild | Parameterized replaceable guild metadata |
| `30316` | P2P bytes receipt | Signed contribution observation |
| `30317` | Stream moderation action | Mute, block, or clear action scoped to a stream |
| `30318` | Stream role | Broadcaster-assigned moderator or subscriber role |
| `30319` | Guild membership | Join/leave state |
| `30320` | Guild role | Guild owner-assigned role |
| `30321` | Discovery moderation | Official-client hide/show decision |
| `10030` | Custom emotes | Broadcaster emote mapping |
| `1984` | Report | NIP-56-compatible abuse report |
| `4` | Direct message / whisper | NIP-04 encrypted private message |

The client can read legacy kind `1` stream chat for compatibility, but new public stream chat is published as kind `1311`. Kind `30313` is a manifest event, not a moderation event. The current private-message path uses kind `4`, not the obsolete kind `20004` draft.

## Stream Announcement: Kind 30311

A stream announcement is parameterized replaceable. Required tags are:

```text
["d", "<streamId>"]
["title", "<title>"]
["status", "live" | "ended"]
```

Common optional tags include:

```text
["summary", "<description>"]
["image", "<poster URL>"]
["streaming", "<media URL>"]
["discoverable", "0" | "1"]
["stream_visibility", "public" | "private"]
["viewer_allow", "<viewer pubkey>"]
["host_mode", "p2p_economy" | "host_only"]
["rebroadcast_threshold", "<positive integer>"]
["payment", "<asset>", "<address>", "<network>", "<label>", "<amount>"]
["caption", "<language>", "<label>", "<URL>", "0" | "1"]
["rendition", "<id>", "<URL>", "<bandwidth>", "<width>", "<height>", "<codecs>"]
["r", "<reference URL>"]
["t", "<topic>"]
```

Supported payment asset identifiers are `xmr`, `eth`, `btc`, `usdt`, `xrp`, `usdc`, `sol`, `trx`, `doge`, `bch`, `ada`, and `pepe`. An advertised address is not proof that the viewer's payment was settled.

## Chat, Presence, and Moderation

Public chat and presence events include:

```text
["a", "30311:<streamPubkey>:<streamId>"]
```

Chat uses kind `1311`; presence uses kind `30312`. Presence is an approximate heartbeat and must not be treated as an authenticated unique-viewer count.

Moderation actions use kind `30317` with `a`, `d`, `p`, and `action` tags. Stream role assignments use kind `30318` and are valid only when signed by the stream owner. Official-client discovery moderation uses kind `30321`; it changes dStream's indexed surfaces and does not erase relay history.

## Media and Viewer Assist

The canonical origin stream path is:

```text
originStreamId = <streamPubkey>--<streamId>
WHIP           = /api/whip/<originStreamId>/whip
WHEP           = /api/whep/<originStreamId>/whep
HLS            = /api/hls/<originStreamId>/index.m3u8
```

The player can attempt WHEP and fall back to HLS. HLS rendition and segment timing are media-pipeline configuration, not fixed protocol constants.

Viewer assist uses kind `8108` events with recipient `p`, stream `a`, and optional `expiration` tags. The JSON payload version is `1` and supports `offer`, `answer`, `candidate`, `bye`, `ping`, and `pong`. Connected peers exchange requested HLS bytes over WebRTC data channels. This is not WebTorrent and does not use public torrent trackers or info hashes.

P2P availability is opportunistic. Clients must preserve origin fallback, and peers must not be trusted as the authoritative source of media bytes.

## Integrity Manifest: Kind 30313

Manifest events contain these tags:

```text
["d", "<streamPubkey>:<streamId>:<renditionId>:<epochStartMs>"]
["a", "30311:<streamPubkey>:<streamId>"]
["r", "<renditionId>"]
["epoch", "<epochStartMs>", "<epochDurationMs>"]
```

The JSON content is versioned and contains stream identity, rendition, epoch, optional initialization segment, and one or more `{ uri, sha256, byteLength? }` segment records. A client must verify the Nostr signature, scope tags, manifest fields, and SHA-256 digest before treating a segment as verified.

## Payments

Creators advertise wallet destinations in kind `30311` payment tags and profile metadata. Payment intents bind the buyer, recipient, asset, network, amount, purpose, expiration, and one-time settlement reference. Verification is performed by the configured backend adapter; missing adapters fail closed.

The public deployment currently requires verified Monero, Bitcoin Lightning, and Bitcoin on-chain rails. Other adapters are protocol-compatible options, not automatically active services. Private keys and wallet seeds remain in user-controlled wallets and are never protocol fields.

## Compatibility and Source of Truth

- Event builders and parsers: `.dstream-work/packages/protocol/src`
- Payment rail mapping: `.dstream-work/apps/web/src/lib/payments/rails.ts`
- Playback and assist implementation: `.dstream-work/apps/web/src/components/Player.tsx` and `.dstream-work/apps/web/src/lib/p2p`
- Deployment configuration: [CONFIG.md](CONFIG.md)

Historical ADRs explain why some choices changed. When prose and code disagree, the tested canonical protocol package controls current behavior; the mismatch should then be corrected here.
