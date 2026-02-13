# Wallet Certification Matrix (Cake / Feather / CLI)

Last updated: 2026-02-10

This runbook certifies real wallet interoperability against dStream verified-tip flows.

## Scope

The certification confirms:

- dStream creates unique Monero subaddresses per stream scope,
- external wallets can send to those subaddresses,
- dStream detects transfers via wallet RPC polling,
- confirmation policy is enforced when required.

## Preflight

1. dStream stack is up (`npm run stack:up` or equivalent).
2. Wallet RPC health is green:
   - `npm run smoke:wallet:cap`
   - optionally: `CAP_PROBE_MODE=passive npm run smoke:wallet:cap` for strict real-wallet daemons
3. If running manually, keep the script process alive while sending from wallets.

For fully autonomous local real-wallet validation (no manual wallet action):

```bash
npm run stack:up:real-wallet
npm run smoke:wallet:real
```

For mock baseline certification:

```bash
npm run stack:up
AUTO_INJECT=1 npm run smoke:wallet:matrix
```

## Matrix run

Run the full certification sequence:

```bash
npm run smoke:wallet:matrix
```

Wallet order:

1. `cake`
2. `feather`
3. `cli`

Shortcuts:

```bash
npm run smoke:wallet:cake
npm run smoke:wallet:feather
npm run smoke:wallet:cli
```

Mock-only automation (for CI/local baseline only):

```bash
AUTO_INJECT=1 npm run smoke:wallet:matrix
```

## CLI wallet hint

For `monero-wallet-cli`, a typical send format is:

```bash
transfer <priority> <address> <amount>
```

Use the address printed by the smoke script for that wallet step.

## Evidence to capture

For each wallet, capture:

- wallet label (`cake`, `feather`, `cli`)
- generated pay-to address
- detected txid
- detected amount (atomic units)
- confirmation status (`confirmed=yes`)

Script output already prints a summary in this format.

## Failure handling

If a wallet step times out:

1. Re-run that wallet shortcut (`npm run smoke:wallet:<wallet>`).
2. Increase timeout:
   - `TIMEOUT_SECS=600 npm run smoke:wallet:<wallet>`
3. If detection works but confirmation lags:
   - `REQUIRE_CONFIRMED=0 npm run smoke:wallet:<wallet>`
   - then rerun with confirmed requirement enabled.
