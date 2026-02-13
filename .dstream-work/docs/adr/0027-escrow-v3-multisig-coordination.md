# ADR 0027: Escrow v3 Multisig Coordination

- Status: Accepted
- Date: 2026-02-10

## Context

ADR `0026` set two constraints:

1. Keep escrow trust claims explicit (no false "on-chain trustless escrow" claim), and
2. Certify wallet compatibility via method-profile probing.

What remained to ship was concrete coordination behavior for escrow-v3 multisig flows.

## Decision

Implement a coordinator/participant escrow-v3 session API backed by wallet RPC multisig methods.

Routes:

- `POST /api/xmr/escrow/session`
  - coordinator starts a stream-scoped session and gets coordinator prepare info.
- `GET /api/xmr/escrow/session/:sessionId`
  - coordinator or participants fetch current session state.
- `POST /api/xmr/escrow/session/:sessionId/participant`
  - participant submits `prepare` or `exchange` multisig info.
- `POST /api/xmr/escrow/session/:sessionId/make`
  - coordinator executes `make_multisig`.
- `POST /api/xmr/escrow/session/:sessionId/exchange`
  - coordinator executes `exchange_multisig_keys`.
- `POST /api/xmr/escrow/session/:sessionId/import`
  - coordinator executes `import_multisig_info`.
- `POST /api/xmr/escrow/session/:sessionId/sign`
  - coordinator executes `sign_multisig`.
- `POST /api/xmr/escrow/session/:sessionId/submit`
  - coordinator executes `submit_multisig`.

All routes require NIP-98 auth and enforce stream/session-scoped authorization.

## Consequences

- Escrow-v3 is now testable as a real multisig coordination flow rather than a capability placeholder.
- Trust boundary remains unchanged: this is coordinated wallet-RPC settlement, not autonomous contract escrow.
- QA can verify this path with:
  - `npm run test:monero`
  - `npm run smoke:escrow:v3`

