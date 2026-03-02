# ADR 0024: Guilds / Curated Discovery

Status: Accepted  
Date: 2026-02-07

## Context

JRNY parity requires “guilds / curated discovery primitives” to exist as a decentralized discovery layer (no central registry).

We already use Nostr for discovery (stream announces: kind `30311`). We need a minimal, composable way to publish:

- a *guild* (curation list) definition
- a set of “featured” streams for that guild

…that can be consumed by clients and integrated into browse/search.

## Decision

### 1) Guild definition is a NIP-33 style parameterized replaceable event

- **Kind**: `30315` (`GUILD`)
- **Coordinate**: `(kind, pubkey, d)` where `d = guildId`
- **Semantics**: latest event wins per coordinate

### 2) Guild event tags

Required:

- `["d", guildId]` (stable id / slug; non-empty string)
- `["name", name]` (non-empty string)

Optional:

- `["about", about]`
- `["image", url]`
- `["t", topic]` (0+)

Featured streams:

- `["a", "30311:<streamPubkeyHex>:<streamId>"]` (0+), where the `a` tag references a stream announce (kind `30311`).

### 3) Canonical user-facing routing

To avoid ambiguity when multiple authors choose the same `guildId`, the canonical route is:

- `/guilds/:npubOrHex/:guildId`

Clients must accept either `npub…` or 64-hex pubkey and normalize internally to hex.

## Consequences

- Guilds are discoverable and verifiable via Nostr (publisher-signed).
- Curation is explicit and portable (`a` tags reference stream coordinates).
- Editing a guild is implemented by publishing a new replaceable event under the same `(pubkey, guildId)` coordinate.
- Guild membership/roles/moderation are separate concerns and are **not** defined by this ADR (handled in later phases).

