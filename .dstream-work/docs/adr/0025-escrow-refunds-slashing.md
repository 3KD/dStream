# ADR 0025: Stake Escrow Settlement (Refunds + Slashing)

- Status: Accepted
- Date: 2026-02-07

## Context

ADR `0022` intentionally scoped "staking" to stake-gated P2P assist and deferred trustless escrow/refunds/slashing.

The rebuild still needs a real settlement mechanism that:

- deters free-riding in P2P delivery,
- supports explicit refund and slashing actions,
- is testable end-to-end with no placeholder behavior.

Monero does not provide smart-contract escrow in this architecture. So v2 settles stake with a trust-minimized, origin-enforced flow using wallet RPC and verifiable signed evidence.

## Decision

### 1) Stake is collateral until settlement

Stake is paid to a unique Monero subaddress allocated per viewer session (same stake session model as ADR `0022`).

Settlement actions move funds from that subaddress:

- **refund** to a viewer-provided Monero address,
- **slash** to the broadcaster's wallet address after an expiry window.

### 2) Settlement uses wallet RPC sweeps

The origin uses `sweep_all` constrained to the stake subaddress index.

This provides deterministic behavior for local and test environments:

- if unlocked balance exists, it is moved,
- if already settled, no funds remain to move.

### 3) Refund requests include signed participation receipts

Refund requests may include signed P2P participation receipts:

- Nostr kind `30316`,
- scoped by `a=30311:<streamPubkey>:<streamId>`,
- includes `fromPubkey` and `servedBytes`,
- validated server-side before refund acceptance when receipt thresholds are configured.

This is evidence-backed but not fully trustless on-chain enforcement.

### 4) Trust model is explicit

This flow is not on-chain trustless escrow.

It is origin-controlled settlement with transparent, deterministic rules. UI and docs must not over-claim.

## Consequences

- Add protocol kind `30316` (build/parse/tests).
- Add wallet RPC support needed for settlement:
  - subaddress balances,
  - subaddress-constrained sweeps.
- Add API routes:
  - viewer refund request (`/api/xmr/stake/session/[token]/refund`),
  - broadcaster slashing (`/api/xmr/stake/slash`).
- Add watch/dashboard UX for refund/slash actions with real route wiring.
- Add tests for receipt parsing and wallet settlement behavior.

