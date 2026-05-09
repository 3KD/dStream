# Access Entitlements Contract (Schema + API)

## Goal

Create one canonical backend model for **who can do what** across:

- live stream watch
- Video watch
- chat send
- P2P assist / rebroadcast participation

The same evaluator must power all access checks so behavior is deterministic and auditable.

## Existing Reuse Points

Current implementation already has:

- short-lived playback token issuance (`POST /api/playback-access/issue`)
- private stream / private Video checks from signed stream announce + allowlist
- Monero verified backend settlement flows (`/api/xmr/*`)
- external purchase verification hook for non-XMR rails (`/api/access/video-packages/purchase` + verifier adapter)
- package payment-session lifecycle (`/api/access/video-packages/session/*`) so node operators can allocate or observe package-specific payment targets before the entitlement grant path runs
- Monero package payment sessions now allocate a unique wallet-rpc subaddress per purchase session and grant access only after confirmed observation on that subaddress

This contract layers a persistent entitlement model under that token issuance path.

## Access Model

### Subject

- `subject_pubkey` (Nostr hex pubkey, lowercase, 64 chars)

### Resource

Resource IDs are canonical strings:

- `stream:<hostPubkey>:<streamId>:live`
- `stream:<hostPubkey>:<streamId>:chat`
- `stream:<hostPubkey>:<streamId>:video:<videoId>`
- `stream:<hostPubkey>:<streamId>:playlist:<playlistId>`

### Actions

- `watch_live`
- `watch_video`
- `chat_send`
- `p2p_assist`
- `rebroadcast`

### Policy precedence

1. explicit deny
2. owner/admin/operator grant
3. VIP/guild waiver grant
4. paid entitlement grant
5. public fallback
6. deny

## SQL Schema (Postgres)

```sql
create type entitlement_source as enum (
  'owner_grant',
  'vip_waiver',
  'guild_waiver',
  'purchase_verified',
  'purchase_unverified',
  'manual_grant',
  'migration'
);

create type entitlement_status as enum ('active', 'revoked', 'expired');

create table access_entitlements (
  id uuid primary key,
  host_pubkey char(64) not null,
  subject_pubkey char(64) not null,
  resource_id text not null,
  actions text[] not null, -- subset of canonical actions
  source entitlement_source not null,
  source_ref text null, -- payment session id, txid, guild id, admin action id
  status entitlement_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoke_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_access_entitlements_subject
  on access_entitlements(subject_pubkey, status, expires_at);

create index idx_access_entitlements_resource
  on access_entitlements(resource_id, status, expires_at);

create index idx_access_entitlements_host
  on access_entitlements(host_pubkey, status, expires_at);

create table access_denies (
  id uuid primary key,
  host_pubkey char(64) not null,
  subject_pubkey char(64) not null,
  resource_id text not null,
  actions text[] not null,
  reason text null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_access_denies_scope
  on access_denies(host_pubkey, subject_pubkey, resource_id);

create table access_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  host_pubkey char(64) not null,
  subject_pubkey char(64) null,
  resource_id text not null,
  action text not null,
  allowed boolean not null,
  reason_code text not null, -- deny_explicit, allow_paid, allow_owner, allow_public, etc.
  entitlement_id uuid null,
  request_id text null,
  metadata jsonb not null default '{}'::jsonb
);

create table payment_settlements (
  id uuid primary key,
  host_pubkey char(64) not null,
  subject_pubkey char(64) null,
  rail_id text not null, -- xmr, lightning, utxo, evm, etc.
  asset text not null, -- xmr, btc, eth, ...
  amount text null,
  tx_ref text null, -- txid/hash/invoice id
  verification_state text not null, -- verified | pending | unverified
  settled_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index uq_payment_settlements_ref
  on payment_settlements(rail_id, tx_ref)
  where tx_ref is not null;

create table payment_sessions (
  id uuid primary key,
  package_id uuid not null,
  host_pubkey char(64) not null,
  subject_pubkey char(64) not null,
  rail_id text not null,
  asset text not null,
  status text not null, -- created | awaiting_payment | pending_operator | verified | granted | expired | failed
  proof_mode text not null, -- operator_observed | client_tx_ref | client_settlement_proof | none
  operator jsonb not null,
  target jsonb not null,
  settlement_ref text null,
  entitlement_id uuid null,
  purchase_id uuid null,
  error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz null
);
```

## Token Contract

### Access token claims

```json
{
  "v": 1,
  "sub": "viewer_pubkey_hex64",
  "host": "host_pubkey_hex64",
  "res": "stream:<host>:<streamId>:live",
  "act": ["watch_live", "chat_send"],
  "src": "entitlement:<uuid>|allowlist|owner|public",
  "iat": 1739990000,
  "exp": 1739990600,
  "jti": "random_nonce"
}
```

Notes:

- TTL: 5–15 minutes.
- Refresh requires re-evaluation against current entitlement/deny state.
- Revocation is immediate because refresh and new checks hit entitlement tables.

## API Contracts

### `POST /api/access/evaluate`

Evaluates policy without minting token.

Request:

```json
{
  "subjectPubkey": "hex64",
  "hostPubkey": "hex64",
  "resourceId": "stream:<host>:<streamId>:live",
  "action": "watch_live"
}
```

Response:

```json
{
  "ok": true,
  "allowed": true,
  "reasonCode": "allow_paid",
  "entitlementId": "uuid-or-null",
  "expiresAt": "2026-03-01T10:00:00Z"
}
```

### `POST /api/access/token/issue`

Primary token minting route for watch/chat/P2P.

Request:

```json
{
  "subjectPubkey": "hex64",
  "hostPubkey": "hex64",
  "resourceId": "stream:<host>:<streamId>:live",
  "actions": ["watch_live", "chat_send"],
  "viewerProofEvent": {}
}
```

Response:

```json
{
  "ok": true,
  "allowed": true,
  "token": "<signed-token>",
  "expiresAtSec": 1739990600,
  "reasonCode": "allow_paid",
  "entitlementId": "uuid-or-null"
}
```

### `POST /api/access/token/refresh`

Re-evaluates and issues a new short-lived token if still allowed.

### `POST /api/access/entitlements/grant`

Create/extend entitlement.

Request:

```json
{
  "subjectPubkey": "hex64",
  "hostPubkey": "hex64",
  "resourceId": "stream:<host>:<streamId>:playlist:gold",
  "actions": ["watch_video"],
  "source": "purchase_verified",
  "sourceRef": "settlement:<uuid>",
  "startsAt": "2026-02-24T10:00:00Z",
  "expiresAt": "2026-03-24T10:00:00Z",
  "metadata": {
    "packageId": "monthly-gold"
  }
}
```

### `POST /api/access/entitlements/revoke`

Request:

```json
{
  "entitlementId": "uuid",
  "reason": "chargeback|abuse|manual"
}
```

### `POST /api/access/entitlements/list`

Query params:

- `hostPubkey`
- `subjectPubkey` (optional)
- `resourceId` (optional)
- `status=active|revoked|expired`
- `limit`

### Settings panel (implemented)

`/settings` now includes an **Access Entitlements** admin panel that can:

- list entitlements by host/subject/resource/status
- grant entitlements (manual/vip/guild/purchase sources) with action scope and optional expiry
- revoke active entitlements with optional reason

All panel actions sign a short-lived Nostr proof event with `["dstream","access_admin"]` and call the access APIs.

`/settings` also includes a **Deny Rules & Audit** panel that can:

- upsert explicit deny rules by subject/resource/action
- list active deny rules
- inspect access audit records (allow/deny reason codes)

### `POST /api/access/denies/upsert`

Sets explicit deny rule for subject/resource/actions.

### `POST /api/access/denies/list`

Lists active deny rules for host/subject/resource filters.

### `POST /api/access/audit`

Operational/audit listing of policy decisions.

## Rail Integration Contract

A rail adapter must emit a settlement record, then grant entitlement:

1. rail verifies payment (or marks unverified)
2. write `payment_settlements`
3. call entitlement grant

Current state:

- Monero: verified backend settlement available in-tree now.
- Lightning: signed NIP-57 zap receipts can now verify package purchases in-tree when the receipt request is explicitly bound to the package and session.
- Monero stake session verify route now supports automatic verified entitlement grants (`purchase_verified`) when confirmed stake is observed.
- Monero package session verify path now uses the same wallet-rpc subaddress operator pattern as tips/stake: allocate unique subaddress, observe confirmed incoming transfer, normalize to `VerifiedPaymentSettlement`, then grant access.
- Monero refund/slash routes now revoke matching stake-session entitlements automatically.
- Non-XMR rails use the same contract through verifier/operator functions: the buyer wallet may initiate payment, but the grant path consumes only a normalized `VerifiedPaymentSettlement`.
- In-tree verifier coverage now includes Lightning zap receipts, EVM native/ERC-20 transfers, Solana native transfers, TRON native/TRC-20 transfers, XRPL payments, BTC outputs, DOGE/BCH node-RPC outputs, and Cardano Blockfrost UTXOs.
- DOGE, BCH, and Cardano require explicit node/provider configuration; BTC/EVM/Solana/TRON/XRPL have public/default fallback endpoints but production deployments should configure their own providers.
- Wallet/app/CLI handoff is payment initiation UX, not entitlement truth.
- Payment sessions now sit in front of paid archive grants: dStream creates the session, the node operator or embedded reference flow resolves settlement, and entitlement grant only happens once the session resolves into a verified settlement.
- Node operators can expose `/sessions/create`, `/sessions/status`, and `/sessions/observe` while keeping custody and rail-specific execution outside the central dStream server.
- The app now exposes that same operator contract in-tree at `/api/payment-operator/sessions/*`; non-XMR paid packages default to that built-in operator from the package settings UI unless a host supplies a custom operator endpoint.
- The built-in operator now supports XMR wallet-rpc subaddresses, Lightning zap-invoice sessions, amount-delta observer sessions for EVM/Solana/TRON/UTXO/Cardano, and XRPL destination-tag or amount-delta sessions.
- Operator readiness is exposed at `/api/payment-operator/readiness` and surfaced in `/settings/monetization`; live provider/node reachability is covered by `npm run smoke:payments:live`.
- `docs/PAYMENT_OPERATOR_API.md` defines the canonical HTTP payloads for those session endpoints so every rail can plug into the same operator contract.

So paid gating should currently be:

- **verified mode**: any rail can auto-grant if it produces a valid `VerifiedPaymentSettlement`.
- **operator override mode**: host can explicitly confirm a purchase when policy allows it.
- **legacy compat mode**: unverified fallback remains opt-in and explicitly labeled as legacy.
  It is now gated behind `DSTREAM_ACCESS_ALLOW_LEGACY_PAYMENT_SESSION_FALLBACKS=1` for non-XMR archive packages.

## Rollout Plan (Safe)

1. Introduce evaluator + tables (no behavior change).
2. Make `POST /api/playback-access/issue` call evaluator.
3. Add admin grant/revoke/list UI in Settings. ✅
4. Attach verified settlement records to automatic grants.
5. Harden remaining provider-backed verifier edges, live-provider deployment certification, and optional external verifier hooks against the canonical settlement contract.

## Backward Compatibility

Until full migration:

- existing announce allowlists still work;
- evaluator maps allowlist/public/private logic into reason codes;
- playback tokens remain short-lived HMAC tokens with expanded claims.
