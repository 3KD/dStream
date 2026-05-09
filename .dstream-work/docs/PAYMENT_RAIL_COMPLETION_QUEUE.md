# Payment Rail Completion Queue

Last updated: 2026-04-26

This document exists to stop payment-scope drift.

It is the concrete implementation queue for making every paid-access rail behave like the current Monero reference flow as closely as the underlying chain allows.

## Target model

For every paid archive purchase:

1. dStream creates a payment session.
2. The responsible node operator allocates a session-specific payment target or session-specific settlement scope.
3. The buyer pays through wallet/provider UX.
4. The operator observes or verifies settlement.
5. The operator returns a canonical `VerifiedPaymentSettlement`.
6. dStream grants access from that normalized settlement record.

## Rules

- `xmr` is the reference rail. Other rails should converge toward its operator-observed flow, not invent one-off purchase logic.
- `PaymentSettlementProof -> VerifiedPaymentSettlement` remains the only settlement contract.
- The central dStream server does not hold spend keys or derivation material.
- The node operator owns rail-specific accomplishment.
- Buyer wallet UX is payment initiation, not entitlement truth.
- `client_tx_ref` and `client_settlement_proof` are fallback/dev modes, not the production target state for non-XMR rails.

## Automation legend

- `A` XMR-grade: unique session target + operator-observed settlement + no normal manual proof entry.
- `A-` Operator-observed with a weaker session scope: the built-in operator can allocate a session-specific scope and observe settlement, but the scope may be an amount delta/reference on a reusable host target rather than a fresh rail-native address.
- `B` Buyer-automatic: the common wallet flow can usually return a usable tx/proof automatically, but live operator observation still depends on provider/node configuration or a custom operator.
- `C` Contract-ready: the shared session/settlement contract exists, but the rail still needs real operator allocation/watch logic to become seamless.

## Rail-by-rail state

| Rail | Assets | Current grade | Real now | Missing still | Batch |
|---|---|---:|---|---|---:|
| `xmr` | `xmr` | `A` | Built-in operator allocates wallet-rpc subaddress and observes settlement directly. | Maintain as reference implementation. | Reference |
| `lightning` | `btc` over Lightning | `A-` | Built-in operator can turn a signed NIP-57 zap request plus LNURL/Lightning-address package target into a BOLT11 invoice, then poll relays for the matching zap receipt and verify it in-tree. Static invoice targets still work as targets but are not a full auto-observed operator flow. | Live LNURL/zap target certification, clearer operator health beyond optional `DSTREAM_ACCESS_LIGHTNING_HEALTH_URL`, and robust relay failure handling. | A |
| `evm` | `eth`, `usdt`, `usdc`, `pepe` | `A-` | Built-in operator reserves a unique atomic amount delta/reference on the package target and can observe via JSON-RPC block/transfer scan; MetaMask tx capture can also feed `/observe`. | WalletConnect/mobile parity, production RPC configuration, and stronger privacy/scaling than amount-delta scoping. | B |
| `solana` | `sol` | `A-` | Built-in operator reserves a unique lamport delta/reference and can observe signatures/account history via JSON-RPC; Phantom signature capture can also feed `/observe`. | Non-Phantom connector coverage, production RPC configuration, and stronger privacy/scaling than amount-delta scoping. | B |
| `tron` | `trx`, TRON-side `usdt` | `A-` | Built-in operator reserves a unique SUN delta/reference and can observe address history through a TronGrid-compatible endpoint; TronLink tx capture can also feed `/observe`. | Production TRON provider configuration and stronger privacy/scaling than amount-delta scoping. | B |
| `utxo` | `btc`, `doge`, `bch` | `A-` | Built-in operator reserves a unique atomic amount delta/reference and can observe outputs through BTC public fallback or BTC/DOGE/BCH node RPC. | Fresh address derivation/watch-wallet support; BTC/DOGE/BCH production nodes for non-fallback operation. | C |
| `xrpl` | `xrp` | `A-` | Built-in operator allocates a destination tag when the package target has no reference, otherwise reserves a unique drops delta/reference, then observes validated account history. | Production XRPL endpoint, Xaman/mobile polish, and stronger target isolation for high-volume hosts. | C |
| `cardano` | `ada` | `A-` | Built-in operator reserves a unique lovelace delta/reference and observes UTXOs through Blockfrost. | CIP-30/mobile wallet polish and production Blockfrost/provider configuration. | C |

## Productionization queue state

The active polish automation is intentionally narrower than rail design. It tracks production readiness around the already-built operator-session architecture:

| Order | Item | State | Evidence |
|---:|---|---|---|
| 1 | Operator setup UI for all payment rails with health/config/readiness | Done | `/settings/monetization` includes the payment operator readiness panel backed by `/api/payment-operator/readiness`. |
| 2 | Live provider/node smoke for configured rails | Done | `npm run smoke:payments:live` probes configured XMR, Lightning health, UTXO, EVM, Solana, TRON, XRPL, and Cardano providers and skips unconfigured rails. |
| 3 | Clearer viewer payment status timeline | Done | Watch package unlocks render session creation, target allocation, wallet/proof, verifier, and access steps. |
| 4 | Docs cleanup for current payment-operator truth | Done | Payment operator API, status, ADR, entitlement, parity, and traceability docs now match the current built-in operator behavior. |
| 5 | Operator security hardening | Done | Production-like operator routes require a bearer token, remote operator endpoints are constrained to safe HTTP(S) URL shapes, and `harden:deploy` rejects missing/placeholder operator tokens and enabled legacy fallbacks. |
| 6 | Buyer wallet UX polish | Done | Watch package unlocks now show a recommended wallet action card with provider/URI/copy fallback, exact amount, network, target type, reference, and verifier handoff guidance per rail. |
| 7 | Remaining lint warning cleanup | Done | `npm run lint` now completes with 0 warnings after removing stale unused code/dependencies and documenting the intentional raw-image policy in ESLint. |

## Batch A — Lightning

Goal: make Lightning the first non-XMR rail that reaches XMR-grade operator behavior.

Deliverables:

- Keep operator-side invoice or zap-bound session target allocation working against real LNURL/Lightning-address targets.
- Keep operator-side settlement observation working through matching NIP-57 zap receipts.
- Auto-capture the normal buyer path so the watch UI does not require pasted receipt JSON in normal operation.
- Keep pasted receipt JSON only as emergency fallback.

Exit criteria:

- Lightning package unlocks complete from operator observation in the normal path against at least one live LNURL/zap target.
- Manual zap receipt paste is not the common UX.
- Smoke proves `create -> allocate -> observe -> grant` against the configured target.

## Batch B — EVM / Solana / TRON

Goal: keep strong buyer-side wallet UX while making session finalization operator-consistent.

Deliverables:

- `evm`: add WalletConnect/mobile parity and keep MetaMask tx capture automatic.
- `solana`: keep Phantom auto-send and close the session automatically from returned signature.
- `tron`: keep TronLink auto-send and close the session automatically from returned tx id.
- Keep operator/session state authoritative for all three rails even when the wallet provides the proof.
- Certify production RPC/provider configuration with `npm run smoke:payments:live`.

Exit criteria:

- Common wallet flows return usable tx refs automatically.
- Operator/session finalization is the normal grant path.
- Manual tx-hash paste is fallback only.
- Smoke proves one automatic flow for each rail.

## Batch C — UTXO / XRPL / Cardano

Goal: harden the operator infrastructure these rails need for true seamlessness.

Deliverables:

- `utxo`: keep amount-delta observation working now; add unique address allocation/watch-wallet support for stronger production privacy and attribution.
- `xrpl`: keep destination-tag/amount-delta observation working now; add first-class Xaman/mobile polish.
- `cardano`: keep Blockfrost amount-delta observation working now; add CIP-30 or purchase-specific address/session bridge.
- Keep buyer proof paste non-normal by giving the operator enough session-specific targeting to identify the payment without user reconciliation.

Exit criteria:

- Each session gets a unique attributable target or reference.
- Host operator can close the session without manual buyer proof in the normal path.
- Smoke proves `create -> allocate -> observe -> grant` for each rail family with configured providers.

## Definition of done per rail

A rail is only "done" when all of these are true:

- Session target or session scope is unique per purchase.
- Buyer does not normally paste proof.
- Operator completes settlement automatically.
- Settlement lands in canonical `VerifiedPaymentSettlement`.
- Access grant consumes that settlement through the shared contract.
- A smoke test proves the full rail path end to end.

## Immediate implementation order

This productionization queue is complete. Future payment work should be tracked as a new scoped queue rather than reopening this one.

## What not to do

- Do not add more one-off wallet copy flows and call that completion.
- Do not let non-XMR production paths drift back toward shared static addresses as the normal pattern.
- Do not let manual tx/proof paste become the default user experience again.
- Do not create rail-specific entitlement logic outside the shared settlement contract.
