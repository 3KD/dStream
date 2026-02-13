# ADR 0026: Escrow v3 Boundary + Wallet Capability Certification

- Status: Accepted
- Date: 2026-02-10

## Context

The rebuild already ships:

- verified Monero tips (ADR `0021`),
- stake-gated P2P assist (ADR `0022`),
- refund/slash settlement with wallet RPC sweeps (ADR `0025`).

What remains contentious is the phrase "trustless escrow".

Monero in this stack does not provide an EVM-style on-chain contract surface for autonomous slashing/refund logic.
So we need a strict boundary that prevents over-claiming and a concrete way to validate wallet compatibility before enabling advanced settlement modes.

## Decision

### 1) Explicit boundary

"On-chain trustless escrow" is not a current deliverable in this architecture.

Current highest-fidelity implementation remains:

- origin-enforced, evidence-backed settlement (ADR `0025`).

Future escrow-v3 work can pursue non-custodial multisig coordination, but this ADR does not claim contract-level trustlessness.

### 2) Wallet capability profiles are canonical

We define capability profiles that can be probed against a configured wallet RPC:

- `tip_v1`
- `stake_v2`
- `escrow_v3_multisig`

Each profile maps to required wallet RPC methods.

### 3) Capability probing is a shipped interface

Add API route:

- `GET /api/xmr/capabilities`

The response includes:

- wallet version/config context,
- per-method support results,
- per-profile readiness + missing methods.

### 4) Certification smoke is required

Add smoke command:

- `npm run smoke:wallet:cap`

This command gates readiness claims for the required profile (`REQUIRE_PROFILE`).

## Consequences

- Product/docs must stop claiming "trustless escrow" as complete behavior.
- Deployment and QA can verify wallet readiness before enabling higher-assurance settlement flows.
- Escrow-v3 implementation may proceed incrementally, but only after profile-level capability checks pass.
