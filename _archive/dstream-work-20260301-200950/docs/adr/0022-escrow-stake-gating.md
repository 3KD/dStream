# ADR 0022: Escrow / Stake Gating (Anti-Leech v1)

- Status: Accepted
- Date: 2026-02-06

## Context

JRNY’s protocol vision includes escrow/staking to deter free-riding (“leeching”) in P2P swarms.

Implementing a fully trustless, slashing/refund mechanism in Monero is non-trivial. We still need a real, testable v1 mechanism that:

- is honest about what it guarantees,
- does not show placeholder UI,
- provides an actual deterrent and a lever for “verified peers” access.

## Decision

### 1) v1 implements stake-gated P2P assist (not full trustless escrow)

In v1, “staking” is implemented as **stake gating** for enabling P2P assist:

- Streams may require a stake to enable P2P assist for viewers.
- The stake is a Monero payment to a **unique subaddress** allocated by the broadcaster’s origin.

This is not a smart-contract escrow. It is a deterrent mechanism that is verifiable by the broadcaster.

### 2) Stake requirement is explicit in announces

Stream announces (kind `30311`) MAY include:

- `["stake", "<amountAtomic>"]` (amount in atomic units; optional)
- `["stake_note", "<short human note>"]` (optional)

If absent, no stake is required.

### 3) Verified peers bypass (optional)

If the broadcaster has a trusted-peers list, they MAY exempt trusted pubkeys from stake requirements.

The trusted model must be explicitly documented (local list and/or Nostr-synced) and must not be silently implied.

### 4) UX rules

- If stake is required and not satisfied, “P2P assist” toggles/buttons must be hidden or disabled with a clear reason.
- The watch page may show a “Get stake address” flow only when the origin RPC is configured and reachable.
- No placeholder escrow UI is allowed.

## Consequences

- We must implement:
  - announce parsing for stake tags
  - server-side stake address allocation + stake verification via wallet RPC
  - watch UX gating for P2P assist based on stake verification
- We must add tests for:
  - stake tag parsing
  - mocked RPC stake verification

Future work (requires new ADR): slashing/refund evidence model, neighbor consensus, and automated stake return.

