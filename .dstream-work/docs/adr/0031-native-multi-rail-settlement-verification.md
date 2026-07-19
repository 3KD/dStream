# ADR 0031: Native Multi-Rail Settlement Verification

- Status: Accepted
- Date: 2026-07-19

## Context

dStream advertised several payment assets, but only Monero had server-side verification. BTC, ETH, and TRX actions stopped at a browser provider or wallet URI, so they could not safely grant an entitlement. A client-supplied transaction ID alone is not proof unless it is checked against a trusted recipient, amount, network, successful chain receipt, confirmation policy, and prior use.

## Decision

Add built-in, noncustodial settlement adapters for:

- BTC on-chain through a configured Bitcoin Core JSON-RPC endpoint.
- Native ETH through a configured Ethereum JSON-RPC endpoint.
- Native TRX through a configured TRON HTTP API endpoint.

Video access packages may store a trusted `paymentAddress`. The purchase API verifies the submitted transaction against the package asset, address, amount, and rail before granting access. Verified blockchain references are recorded in a durable, lock-protected settlement store. One chain settlement may be reused only idempotently for the same package and buyer; cross-purchase replay is rejected.

Every adapter fails closed when its RPC is absent, unavailable, on the wrong network, malformed, reverted, underpaid, sent to another recipient, or below the configured confirmation threshold. Runtime availability is exposed without credentials through `/api/payments/capabilities`.

The adapters do not custody funds, create wallets, hold private keys, issue refunds, or operate chain nodes. Deployment supplies its own authenticated RPC services or providers.

Lightning, ERC-20, TRC-20, DOGE, BCH, SOL, XRP, and ADA remain wallet-handoff rails until dedicated verification adapters exist. Native ETH verification must not be used to claim ERC-20 settlement, and native TRX verification must not be used to claim TRC-20 settlement.

## Consequences

- BTC, ETH, and TRX purchases can receive a cryptographically grounded verified-settlement decision once their RPCs are configured.
- The web service needs a persistent `/var/lib/dstream` volume for settlement replay protection and existing access stores.
- Bitcoin Core generally needs transaction indexing for arbitrary transaction lookup.
- RPC service security, availability, and chain correctness become production dependencies.
- Additional assets require separate ADRs or extensions that define token contracts, decimals, event/log checks, finality, and replay keys.
