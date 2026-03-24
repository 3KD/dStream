# ADR 0021: Monero (Verified Tips + Receipts)

- Status: Accepted
- Date: 2026-02-06

## Context

ADR 0017 introduced the minimal “tip address plumbing” (`["xmr","<address>"]`) but it does not provide a *verified* monetization flow.

JRNY’s vision requires:

- Monero-native tipping
- a verification model (wallet RPC) so “tips” can be treated as real events in UX (dashboard, alerts, etc.)

## Decision

### 1) Monero-first (no multi-chain in v1)

For v1 “everything”, verified tipping is **Monero-only**. Any other payment rails (Lightning, EVM, etc.) are out of scope unless introduced by a dedicated ADR + freeze update.

### 2) Verified tips use wallet RPC + subaddresses

The broadcaster’s origin stack runs a Monero wallet RPC (local or remote-node-backed).

The origin exposes a server-only API (Next.js route handlers) that:

1) allocates a unique **subaddress** per tip session
2) checks for incoming transfers to that subaddress

The viewer UI never receives RPC credentials.

### 3) Tip receipt events (optional)

When the origin verifies an incoming tip, it MAY publish a Nostr receipt event:

- **kind:** `30314`
- **scope tag:** `["a", "30311:<streamPubkeyHex>:<streamId>"]`
- **content:** JSON with minimal fields (no attempt at public verifiability; Monero is private)

Example content:

```json
{
  "v": 1,
  "t": "xmr_tip_verified",
  "streamPubkey": "<hex>",
  "streamId": "<string>",
  "amountAtomic": "10000000000",
  "confirmed": false,
  "observedAtMs": 1700000050000
}
```

Notes:

- This receipt is primarily for UX (alerts, dashboard). It is not a public proof.
- If a viewer pubkey is attached, it must be explicit and privacy-reviewed (default: no viewer identity).

## Consequences

- We must add a Monero wallet RPC service/container to local infra, and server-side API routes for:
  - create subaddress (tip session)
  - check incoming transfers
- We must hide verified-tip UI unless RPC is configured and reachable (no placeholder panels).
- We must add unit + integration tests for:
  - receipt schema validation
  - mocked RPC verification logic

