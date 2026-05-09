# ADR 0031: Canonical Multi-Rail Verified Settlement

- Status: Accepted
- Date: 2026-04-21
- Updated: 2026-04-26

## Context

dStream already had two incompatible payment stories:

- Monero used server-side verification and could drive real access decisions.
- Other rails mostly surfaced wallet handoff UX (`copy`, URI, extension open), which was useful for payment initiation but not for interoperable settlement truth.
- The missing middle was a payment-session authority boundary: somebody has to allocate per-purchase targets, watch settlement, and report it back in a canonical shape.

That split is not acceptable for access gating, interop, or auditability. The system needs one payment contract regardless of rail-specific mechanics.

## Decision

### 1) Payment initiation and settlement truth are separate

Wallet apps, extensions, QR codes, URIs, and CLI flows are allowed as payment initiation UX.

They are **not** the source of truth for entitlements.

Unlocks, grants, and receipts must be driven by verified settlement records.

### 1.5) Payment sessions are the orchestration boundary

Paid archive purchases should run through a canonical payment-session contract before entitlement grant:

- `PaymentSessionTarget`: the per-purchase address / invoice / URI payload the viewer actually pays
- `PaymentSessionRecord`: the session status record dStream polls and stores

Responsibility split:

- node operator: allocate or supervise the per-purchase target, observe settlement, and report verified completion
- dStream server: create sessions, poll/update session status, normalize settlement, and grant entitlements
- viewer wallet: execute the payment

### 2) Every rail maps into the same proof and settlement types

The canonical edge contract is:

- `PaymentSettlementProof`: client-supplied or adapter-supplied proof payload
- `VerifiedPaymentSettlement`: verifier-confirmed normalized settlement record

Minimum normalized fields:

- `railId`
- `asset`
- `settlementKind`
- `settlementRef`
- `txRef` when available
- `confirmed`
- `observedAtMs`
- `verifier`

### 3) Multi-rail verification is in-tree; provider coverage is rail-specific

Monero wallet-rpc stays in-tree and remains the reference implementation for:

- dedicated session allocation
- confirmation checks
- settlement-triggered entitlement grants
- refund/slash revocation flows

Other rails must still return the same `VerifiedPaymentSettlement` shape, whether they use direct host-origin RPC/provider lookups, node-operator payment sessions, or an external verifier hook.

Current in-tree verifier coverage:

- Lightning: signed kind `9735` zap receipt verification
  - the receipt request must bind to the target package (`pkg` tag)
  - the verifier checks host pubkey, buyer pubkey, stream scope, package binding, session binding when present, and minimum amount
- EVM: native ETH and ERC-20 transfer verification
- Solana: native SOL transfer verification
- TRON: native TRX and TRC-20 USDT transfer verification
- XRPL: validated payment verification
- UTXO: BTC output verification via public fallback or node RPC, plus DOGE/BCH via node RPC
- Cardano: Blockfrost-backed UTXO output verification

Session modes currently supported in-tree:

- embedded XMR wallet-rpc subaddress sessions for package purchases
- remote HTTP node-operator sessions for operator-observed settlement
- built-in same-origin payment operator routes at `/api/payment-operator/sessions/*`
- built-in Lightning zap-invoice sessions for LNURL/Lightning-address package targets that support NIP-57
- built-in amount-delta observer sessions for EVM, Solana, TRON, UTXO, and Cardano package targets
- built-in XRPL destination-tag or amount-delta observer sessions
- embedded reference sessions for local/dev flows and explicit fallback modes
- the canonical remote operator payloads are documented in `docs/PAYMENT_OPERATOR_API.md`

Operational surfaces currently supported in-tree:

- `/api/payment-operator/readiness` reports per-rail health/config/readiness.
- `/settings/monetization` renders the operator readiness panel and package operator configuration.
- The watch unlock panel renders a payment-session timeline from creation through access grant/failure.
- `npm run smoke:payments` proves route-level session/grant behavior under mocked providers.
- `npm run smoke:payments:live` probes configured live providers/nodes and skips unconfigured rails unless `PAYMENT_LIVE_SMOKE_REQUIRE_CONFIGURED=1`.

### 4) Entitlements consume settlement records, not rail-specific logic

Access grants, purchase records, and automatic revoke flows must key off normalized settlement refs/source refs wherever possible.

Rail-specific behavior is allowed inside rail verifiers, but entitlement storage and evaluation should remain rail-agnostic.

### 5) Legacy fallback paths stay explicit

Operator override and unverified fallback remain compatibility modes only.

They must be:

- policy gated
- explicitly labeled
- excluded from any claim of verified settlement parity

## Consequences

- Paid access can become interoperable across rails without rewriting entitlement logic per chain.
- Audit trails can compare settlements and grants using one record shape.
- Wallet handoff UX can evolve independently from settlement verification.
- Node operators can own rail-specific payment accomplishment without making the central dStream server custodial.
- Shipping a new rail now means building one more proof-to-settlement mapper against the canonical contract, not inventing a new access path.

## References

- `packages/protocol/src/types.ts`
- `apps/web/src/lib/payments/settlement.ts`
- `apps/web/src/lib/access/purchaseVerifier.ts`
- `apps/web/app/api/access/video-packages/purchase/route.ts`
- `docs/ACCESS_ENTITLEMENTS_CONTRACT.md`
