# ADR 0031: Native Multi-Rail Settlement Verification

- Status: Accepted
- Date: 2026-07-19

## Context

dStream advertised several payment assets, but only Monero had server-side verification. BTC, ETH, and TRX actions stopped at a browser provider or wallet URI, so they could not safely grant an entitlement. A client-supplied transaction ID alone is not proof unless it is checked against a trusted recipient, amount, network, successful chain receipt, confirmation policy, and prior use.

## Decision

Add built-in, noncustodial settlement adapters for:

- XMR through unique wallet-RPC subaddress sessions.
- BTC Lightning through signed NIP-57 requests, BOLT11 description hashes, and provider-signed kind `9735` receipts.
- BTC, DOGE, and BCH through configured UTXO-node JSON-RPC endpoints.
- ETH, USDT, USDC, and PEPE through configured EVM JSON-RPC endpoints and allowlisted ERC-20 `Transfer` logs.
- TRX and TRC-20 USDT through a configured TRON HTTP API endpoint.
- SOL and SPL USDC/USDT through finalized Solana transaction and owner-balance data.
- XRP through validated XRP Ledger transaction results and delivered-amount metadata.
- ADA through a Blockfrost-compatible Cardano transaction/UTXO index.

Video access packages may store a trusted `paymentAddress`. The purchase API verifies the submitted transaction against the package asset, address, amount, and rail before granting access. A durable payment intent binds the signed buyer and current package revision to exact payment terms and expires after a bounded window. Verified references are recorded in lock-protected intent and settlement stores. Cross-intent and cross-purchase replay is rejected.

Every adapter fails closed when its RPC is absent, unavailable, on the wrong network, malformed, reverted, underpaid, sent to another recipient, or below the configured confirmation threshold. Runtime availability is exposed without credentials through `/api/payments/capabilities`.

The adapters do not custody funds, create wallets, hold private keys, issue refunds, or operate chain nodes. Deployment supplies its own authenticated RPC services or providers.

Wallet execution remains noncustodial: NWC/WebLN or wallet handoff for Lightning, browser providers for EVM/TRON/Solana, and standards-based wallet requests for UTXO, XRP, and Cardano. A wallet handoff is not itself settlement proof; the corresponding backend adapter must independently verify the resulting receipt or transaction.

## Consequences

- Every advertised asset can receive a verifier-grounded settlement decision once its required provider is configured.
- The web service needs a persistent `/var/lib/dstream` volume for intent, settlement replay protection, and existing access stores.
- Bitcoin Core generally needs transaction indexing for arbitrary transaction lookup.
- RPC service security, availability, and chain correctness become production dependencies.
- Token contracts and mints are explicit allowlists; additional networks require explicit operator configuration.
