# Wallet Certification Matrix

Last updated: 2026-05-14

This runbook certifies real wallet interoperability against dStream verified payment flows.

Wallet QA is not a wallet-copy check. A rail passes only when a funded wallet can initiate the payment and the operator/verifier can normalize the result into the canonical settlement contract that unlocks access.

## What Each Gate Proves

| Gate | Command | Proof level |
|---|---|---|
| Route-level settlement smoke | `npm run smoke:payments` | Mocked all-rail session, verifier, purchase, and access-grant behavior. |
| Live provider/node smoke | `npm run smoke:payments:live` | Configured provider/node reachability for XMR, Lightning health, EVM, Solana, TRON, UTXO, XRPL, and Cardano. |
| Wallet QA readiness | `npm run smoke:wallets:qa` | Rail-by-rail wallet certification readiness, missing env, and funded-wallet pass criteria. |
| XMR wallet matrix | `npm run smoke:wallet:matrix` | Real or injected XMR sends through Cake, Feather, and CLI labels against wallet-rpc session detection. |
| Funded wallet pass | Manual per rail after readiness is green | Real wallet sends payment, verifier observes settlement, purchase record is written, and viewer access unlocks. |

Strict readiness modes:

```bash
ENV_FILE=.env.production npm run smoke:wallets:qa
WALLET_QA_REQUIRE_READY=1 ENV_FILE=.env.production npm run smoke:wallets:qa
WALLET_QA_REQUIRE_ALL=1 ENV_FILE=.env.production npm run smoke:wallets:qa
PAYMENT_LIVE_SMOKE_REQUIRE_CONFIGURED=1 ENV_FILE=.env.production npm run smoke:payments:live
```

Use `--json` when a deployment runner needs machine-readable output:

```bash
ENV_FILE=.env.production npm run smoke:wallets:qa -- --json
```

## Pass Criteria

Every rail must produce the same evidence shape at the app boundary:

- A package payment session is created.
- The operator allocates a concrete target with destination, network, asset, exact amount, and session reference or unique amount delta.
- A funded wallet initiates payment through extension, deep link, QR, or CLI.
- The verifier observes the payment using the configured chain-specific backend.
- The verifier returns a canonical `VerifiedPaymentSettlement`.
- dStream writes the purchase record and grants viewer access.
- Revocation or expiry behavior still works after the grant path.

## Rail Matrix

| Rail | Wallets to certify | Test network | Required verifier backend | Target/proof standard |
|---|---|---|---|---|
| `xmr` | Cake Wallet, Feather, `monero-wallet-cli` | stagenet, regtest, or production daemon-backed wallet-rpc | `DSTREAM_XMR_WALLET_RPC_ORIGIN` plus wallet-rpc auth in production | Unique wallet-rpc subaddress per session; observe txid, atomic amount, and confirmations. |
| `lightning` | Phoenix, Zeus, Alby, Breez | testnet, signet/regtest LN, or production Lightning | Package LNURL/Lightning-address target; optional `DSTREAM_ACCESS_LIGHTNING_HEALTH_URL` | Session-bound invoice or NIP-57 zap receipt; observe settled invoice/receipt. |
| `evm` | MetaMask, Rabby, Coinbase Wallet | Sepolia, Base Sepolia, Polygon Amoy, or production EVM chain | One explicit EVM JSON-RPC env such as `DSTREAM_ACCESS_EVM_RPC_URL` or chain-specific EVM RPC env | Check recipient, native/ERC-20 asset, amount, chain, tx hash, and confirmation. |
| `solana` | Phantom, Solflare, Backpack | devnet or production Solana | `DSTREAM_ACCESS_SOLANA_RPC_URL` | Check recipient, native/SPL asset, lamports/token amount, signature, and confirmation. |
| `tron` | TronLink, Klever | Nile/Shasta or production TRON | `DSTREAM_ACCESS_TRON_RPC_URL` | Check recipient, TRX/TRC-20 asset, SUN/token amount, tx id, and solidity confirmation. |
| `btc` | Sparrow, Electrum, BlueWallet | signet/testnet or production Bitcoin | `DSTREAM_ACCESS_BTC_RPC_URL` for production certification | Check output address, sats, txid, and confirmations. |
| `doge` | Dogecoin Core, MyDoge | testnet or production Dogecoin | `DSTREAM_ACCESS_DOGE_RPC_URL` | Check output address, atomic amount, txid, and confirmations. |
| `bch` | Electron Cash, Bitcoin.com Wallet | chipnet/testnet or production Bitcoin Cash | `DSTREAM_ACCESS_BCH_RPC_URL` | Check output address, sats, txid, and confirmations. |
| `xrpl` | Xaman, GemWallet | XRPL testnet/devnet or production XRPL | `DSTREAM_ACCESS_XRPL_RPC_URL` | Check destination account, tag/reference or amount delta, XRP amount, tx hash, and validated ledger. |
| `cardano` | Lace, Eternl, Nami | preprod/preview or production Cardano | `DSTREAM_ACCESS_CARDANO_BLOCKFROST_URL` and `DSTREAM_ACCESS_CARDANO_BLOCKFROST_PROJECT_ID` | Check UTXO address, lovelace amount, tx hash, and block confirmation. |

## XMR Certification

The existing XMR wallet matrix remains the reference real-wallet flow.

Preflight:

1. dStream stack is up with `npm run stack:up` or `npm run stack:up:real-wallet`.
2. Wallet RPC health is green:

```bash
npm run smoke:wallet:cap
CAP_PROBE_MODE=passive npm run smoke:wallet:cap
```

For fully autonomous local real-wallet validation:

```bash
npm run stack:up:real-wallet
npm run smoke:wallet:real
```

For matrix certification:

```bash
npm run smoke:wallet:matrix
npm run smoke:wallet:cake
npm run smoke:wallet:feather
npm run smoke:wallet:cli
```

Mock-only automation, for CI/local baseline only:

```bash
AUTO_INJECT=1 npm run smoke:wallet:matrix
```

For `monero-wallet-cli`, a typical send format is:

```bash
transfer <priority> <address> <amount>
```

Use the address printed by the smoke script for that wallet step.

## Evidence To Capture

For every wallet/rail pass, capture:

- Rail and asset.
- Wallet name and version.
- Test network and provider/node URL label, not secrets.
- Package id, session id, target type, destination, amount, and reference/tag/delta.
- Wallet-originated txid, signature, invoice, or receipt.
- Verifier result with `railId`, `asset`, `settlementKind`, `txRef`, `amountAtomic`, `confirmed`, and `verifier`.
- Purchase record id and viewer access state after refresh.

## Failure Handling

If readiness is blocked:

1. Run `ENV_FILE=.env.production npm run smoke:wallets:qa`.
2. Configure the missing provider/node env for the blocked rail.
3. Run `ENV_FILE=.env.production npm run smoke:payments:live`.
4. Only then run the funded wallet pass.

If a funded wallet pass times out:

1. Re-check the target was generated from the current session, not an old copy buffer.
2. Re-run the rail with a fresh session and capture the txid/signature immediately.
3. Confirm the operator backend can see the same network as the wallet.
4. For XMR, increase timeout:

```bash
TIMEOUT_SECS=600 npm run smoke:wallet:<wallet>
```

5. If detection works but confirmation lags, temporarily diagnose with:

```bash
REQUIRE_CONFIRMED=0 npm run smoke:wallet:<wallet>
```

Then rerun with confirmation required before counting the pass.
