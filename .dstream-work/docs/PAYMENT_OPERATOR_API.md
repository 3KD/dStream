# Payment Operator API

Last updated: 2026-04-26

dStream uses one canonical HTTP contract when a host-side payment operator is responsible for session allocation and settlement observation.

The central app does not hold spend keys or chain-specific derivation material. It creates purchase intent, calls the operator, stores normalized settlement, and grants access only after verified settlement is returned.

For local/self-hosted deployments, dStream exposes the same contract in-tree at `/api/payment-operator`. The package settings UI defaults non-XMR paid archive packages to that built-in operator when no custom `paymentSession.operatorEndpoint` is supplied.

## Endpoints

Base URL: the per-package `paymentSession.operatorEndpoint`

- Built-in local operator: `/api/payment-operator`
- Remote/federated operator: any host-provided base URL that implements the same session routes

- `POST /sessions/create`
- `POST /sessions/status`
- `POST /sessions/observe`

All payloads are versioned with `version: 1`.

In production-like modes, `DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN` is required and the built-in operator requires `Authorization: Bearer <token>`. The same env value is sent when dStream calls a remote `paymentSession.operatorEndpoint`.

The built-in operator persists its local session state at `DSTREAM_PAYMENT_OPERATOR_STORE_PATH` or `/var/lib/dstream/payment-operator-sessions.json`.

Endpoint hardening:

- `paymentSession.operatorEndpoint` must be an absolute `http` or `https` URL.
- Embedded credentials, query strings, and URL fragments are rejected.
- Production-like modes require `https` for non-loopback operator endpoints.
- `ENV_FILE=.env.production npm run harden:deploy` rejects missing/placeholder operator bearer tokens and enabled legacy payment fallbacks.

## Create

Request:

```json
{
  "version": 1,
  "sessionId": "c3d5c2b7-7b35-4d4a-8b9c-18d4d9f7f1e2",
  "package": {
    "id": "pkg_123",
    "hostPubkey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "streamId": "stream-1",
    "paymentAsset": "btc",
    "paymentAmount": "0.000015",
    "paymentRailId": "lightning"
  },
  "viewer": {
    "pubkey": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "metadata": {
    "origin": "watch_unlock"
  }
}
```

Success response:

```json
{
  "ok": true,
  "status": "pending_operator",
  "proofMode": "operator_observed",
  "operatorLabel": "Host LN node",
  "target": {
    "version": 1,
    "railId": "lightning",
    "asset": "btc",
    "targetType": "invoice",
    "destination": "lnbc15u1exampleinvoice",
    "network": "lightning",
    "amount": "0.000015",
    "amountAtomic": "1500",
    "walletUri": "lightning:lnbc15u1exampleinvoice"
  }
}
```

Error response:

```json
{
  "ok": false,
  "error": "operator could not allocate a payment target"
}
```

## Status

Request:

```json
{
  "version": 1,
  "sessionId": "c3d5c2b7-7b35-4d4a-8b9c-18d4d9f7f1e2",
  "packageId": "pkg_123",
  "viewerPubkey": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Success responses can either remain pending:

```json
{
  "ok": true,
  "status": "pending_operator"
}
```

or complete with a canonical settlement:

```json
{
  "ok": true,
  "status": "verified",
  "settlement": {
    "version": 1,
    "railId": "lightning",
    "asset": "btc",
    "settlementKind": "bolt11_invoice",
    "settlementRef": "invoice:c3d5c2b7-7b35-4d4a-8b9c-18d4d9f7f1e2",
    "txRef": "c3d5c2b7-7b35-4d4a-8b9c-18d4d9f7f1e2",
    "amountAtomic": "1500",
    "confirmed": true,
    "observedAtMs": 1712345678901,
    "verifier": "host_origin"
  }
}
```

## Observe

`/sessions/observe` is for cases where the viewer wallet or client can return a usable proof or tx reference and the operator wants to consume it.

Request:

```json
{
  "version": 1,
  "sessionId": "c3d5c2b7-7b35-4d4a-8b9c-18d4d9f7f1e2",
  "packageId": "pkg_123",
  "viewerPubkey": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "txRef": "0xdeadbeef"
}
```

The response shape is the same as `/sessions/status`.

## Rail mapping guidance

Current built-in operator behavior:

| Rail | Built-in session target/scope | Observation path | Production provider requirement |
|---|---|---|---|
| `xmr` | Unique wallet-rpc subaddress per session | Wallet-rpc incoming transfer + confirmation count | `DSTREAM_XMR_WALLET_RPC_ORIGIN` and wallet credentials |
| `lightning` | BOLT11 invoice from a signed NIP-57 zap request when the package target is LNURL or Lightning address; static invoice targets remain static | Nostr zap receipt polling and in-tree receipt verification | Nostr relays plus a package Lightning target that supports NIP-57 zap receipts |
| `evm` | Package target plus unique atomic amount delta/reference | JSON-RPC block/transfer scan, or `/observe` with returned tx ref | Explicit EVM RPC env recommended; public defaults are fallback only |
| `solana` | Package target plus unique lamport amount delta/reference | JSON-RPC signature/account scan, or `/observe` with returned signature | `DSTREAM_ACCESS_SOLANA_RPC_URL` recommended; public defaults are fallback only |
| `tron` | Package target plus unique SUN amount delta/reference | TronGrid-compatible address-history scan, or `/observe` with returned tx id | `DSTREAM_ACCESS_TRON_RPC_URL` recommended; default endpoint is fallback only |
| `utxo` | Package target plus unique atomic amount delta/reference | BTC public fallback or BTC/DOGE/BCH node RPC output scan | BTC RPC recommended; DOGE/BCH require node RPC |
| `xrpl` | Destination tag when no package reference exists, otherwise unique amount delta/reference | XRPL account history scan | `DSTREAM_ACCESS_XRPL_RPC_URL` recommended; public default is fallback only |
| `cardano` | Package target plus unique lovelace amount delta/reference | Blockfrost UTXO scan | `DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL` and `DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID` |

Remote operators should implement the same behavior or a stronger rail-native equivalent. A remote operator may allocate unique addresses instead of amount deltas, may use private indexers, and may hide chain-specific mechanics from dStream as long as it returns the canonical session and settlement shapes.

## Readiness and smoke gates

- Operator setup/readiness UI: `/settings/monetization` calls `GET /api/payment-operator/readiness` and shows each rail's health/config/readiness state.
- Route-level session smoke: `npm run smoke:payments` exercises mocked operator/session flows for XMR, Lightning, EVM, Solana, TRON, UTXO, XRPL, Cardano, viewer unlock readback, and private archive playback-token issuance.
- Live provider/node smoke: `npm run smoke:payments:live` probes only configured live providers/nodes. Unconfigured rails are skipped and an all-skipped run reports `no configured probes`, not a proof pass. Set `ENV_FILE=.env.production` to load a production env file, `PAYMENT_LIVE_SMOKE_REQUIRE_CONFIGURED=1` when at least one live provider must be reachable, or `PAYMENT_LIVE_SMOKE_REQUIRE_ALL=1` when every rail must be configured and reachable.
- Wallet QA readiness: `npm run smoke:wallets:qa` reports the rail-by-rail wallet certification matrix, missing provider/node env, and funded-wallet pass criteria. Run `ENV_FILE=.env.production npm run gate:wallets:prod` for the strict production gate: every live provider/node probe must be reachable and every wallet QA rail must be ready.
- Viewer unlock UX: active package sessions render a status timeline for session creation, target allocation, wallet/proof submission, operator verification, and access grant/failure.

## Rules

- The operator owns rail-specific accomplishment.
- dStream owns session orchestration, settlement normalization, and entitlement grant.
- The viewer wallet is initiation UX, not entitlement truth.
- Manual paste is fallback, not the primary contract.
- Non-XMR paid archive packages should use operator sessions by default. Legacy client-side proof fallback remains dev-only and must be explicitly enabled.
