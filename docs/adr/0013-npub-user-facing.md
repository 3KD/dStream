# ADR 0013: User-Facing Pubkeys Use NIP-19 (npub)

- Status: Accepted
- Date: 2026-02-05

## Context

Nostr pubkeys are canonically 32-byte keys typically represented as 64-character hex. Hex is fine for machines but is error-prone for humans (no prefix, no checksum) and does not match the common UX of the Nostr ecosystem.

This project needs a clear boundary:

- **User-facing** identifiers (URLs, UI labels, copy/paste) should be recognizable and resilient.
- **Internal** protocol operations (filters, signing, addressing) should use canonical hex.

## Decision

- The app **emits `npub…`** (NIP-19 bech32) for user-facing pubkey representation:
  - Watch route: `/watch/:npub/:streamId`
  - UI identity display and stream cards show `npub…`
- Internally, the canonical pubkey representation remains **64-char lower-case hex**.
- Boundary rules:
  - Accept either `npub…` or 64-hex in route params for compatibility.
  - Normalize to hex at the boundary and use hex throughout internal logic.

## Consequences

- Links are consistent with Nostr UX and easier to share.
- User error is reduced due to bech32 checksums and the explicit `npub` prefix.
- Documentation must clearly state the conversion and which layers expect which format.

