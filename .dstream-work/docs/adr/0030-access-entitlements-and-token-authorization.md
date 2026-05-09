# ADR 0030: Access Entitlements + Token Authorization Model

- Status: Proposed
- Date: 2026-02-24

## Context

Current access behavior is split across:

- announce-derived private/public gating,
- short-lived playback tokens,
- Monero verified tip/stake session logic,
- payment rails that need to converge on one verified settlement contract.

This works for basic private streams but does not provide one persistent, auditable model for:

- who can watch live,
- who can watch specific Video items/playlists,
- who can chat,
- who can participate in P2P assist/rebroadcast.

## Decision

### 1) Introduce canonical entitlements

Define persistent entitlement and deny records keyed by:

- subject pubkey,
- host pubkey,
- resource id,
- actions,
- lifecycle (`active`, `revoked`, `expired`).

### 2) Use one policy evaluator

All access checks route through one evaluator with strict precedence:

1. explicit deny
2. owner/admin/operator
3. VIP/guild waiver
4. paid entitlement
5. public fallback
6. deny

### 3) Keep short-lived signed tokens

Token issuance remains short-lived and stateless (HMAC/JWT-like), but minting requires policy evaluation.

Refresh/new tokens always re-check current entitlement state.

### 4) Separate settlement from entitlement

Payment rails produce settlement records; entitlement grants are a separate explicit step.

- Every rail must converge on the same settlement truth model:
  - client submits `PaymentSettlementProof` (or an equivalent rail proof payload)
  - verifier returns `VerifiedPaymentSettlement`
  - entitlement grant consumes that normalized record
- Monero wallet-rpc remains the in-tree verifier.
- Lightning, EVM, Solana, TRON, XRPL, and BTC now verify in-tree against the same settlement record shape; Cardano, DOGE, and BCH use the same path once their provider/node envs are configured.

### 5) Preserve backward compatibility

Existing announce allowlist/private/public semantics remain valid and are mapped into evaluator reason codes during migration.

## Consequences

- Access behavior becomes deterministic and auditable.
- Revocation/expiry works consistently across live, Video, and chat.
- Paid access packages (per-item/per-playlist/time-window) become implementable without custom one-off logic.
- Wallet/app handoff can remain a UX detail, but it no longer defines settlement truth.
- Non-verified rails can still be supported with explicit provisional/manual grant policy instead of implicit trust.

## References

- Contract/spec: `docs/ACCESS_ENTITLEMENTS_CONTRACT.md`
- Settlement contract: `docs/adr/0031-canonical-multi-rail-verified-settlement.md`
