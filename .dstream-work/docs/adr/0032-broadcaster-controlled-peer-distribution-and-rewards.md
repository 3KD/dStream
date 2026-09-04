# ADR 0032: Broadcaster-Controlled Peer Distribution and Rewards

- Status: Proposed
- Date: 2026-09-04
- Product direction: Recorded at the project owner's request

## Context

ADR `0029` introduced per-stream `host_only` and `p2p_economy` modes, a bounded active rebroadcaster set, and contribution-based credits. The next iteration should let a broadcaster decide who may officially help distribute a stream, how many helpers may participate, when they may participate, and how much they may consume or earn.

Crypto settlement does not prove that useful network service occurred. Peer admission, delivery verification, accounting, and payout settlement therefore need separate protocols.

This ADR records future product preferences. It does not claim that the controls or reward system below are implemented.

## Decision Proposal

### 1) The broadcaster controls the per-stream distribution policy

Each stream must expose an explicit, broadcaster-signed policy with these operating choices:

1. `host_only`: only the origin is an official delivery source; no peer reward is available.
2. `trusted_helpers`: only broadcaster-approved identities may rebroadcast and earn credit.
3. `managed_reward_pool`: eligible peers may apply, but the broadcaster's admission rules and limits still apply.

The broadcaster must be able to change policy while live and immediately stop new peer admissions or reward accrual.

### 2) Selection is configurable, not permanently FCFS

The broadcaster must be able to choose among:

- manual selection from candidate peers,
- automatic ranking by measured service quality and declared capacity,
- a hybrid that prioritizes trusted peers and fills remaining capacity automatically.

First-come-first-served may remain an optional admission strategy, but it must not be the only strategy.

The broadcaster must be able to approve, pause, remove, block, replace, or permanently trust an individual helper. A standby queue may replace unavailable or underperforming active helpers automatically.

### 3) A hard active-helper limit is required

Every P2P-enabled stream must support a broadcaster-selected maximum active helper count. The policy should also support:

- maximum simultaneous downstream viewers per helper,
- maximum upload bandwidth per helper,
- maximum bytes per helper and policy epoch,
- maximum earnings per helper and policy epoch,
- a stream-wide bandwidth and reward-budget ceiling.

Limits must be enforced by admission and accounting, not only displayed in the UI.

### 4) Participation uses short-lived signed relay leases

An admitted helper receives a short-lived lease signed by the broadcaster or its authorized origin service. At minimum, a lease binds:

```text
stream identity
helper pubkey
lease id and policy revision
valid-from and valid-until timestamps
byte, bandwidth, connection, and reward limits
payout asset and rate
unique nonce
```

Playback clients should prefer officially leased helpers. The reward ledger must reject receipts outside the lease window, above its limits, against an old policy revision, or after revocation.

Leases should expire and renew frequently enough to replace failed helpers without leaving long-lived authority in circulation.

### 5) The broadcaster controls when peer assistance runs

Supported scheduling should include:

- only while the stream is live,
- explicit start and end times,
- manual start and stop,
- demand-triggered activation above a viewer or origin-load threshold,
- automatic stop when the reward budget is exhausted.

Stopping paid participation must not interrupt ordinary origin playback.

### 6) Rewards require receiver-confirmed useful work

Self-reported upload counters are not sufficient for monetary rewards.

After a peer-delivered segment passes manifest/hash verification and arrives before its playback deadline, the receiving peer should sign a cumulative delivery receipt crediting the sending peer. Receipts must include a monotonic sequence, unique challenge or request nonce, stream and session scope, verified bytes, and the covered segment hashes or manifest range.

The accounting service must reject duplicate, stale, self-looped, malformed, unleased, over-limit, or integrity-failing receipts. Pairwise and per-session caps are required to reduce collusive receipt farming.

Contribution classes are treated differently:

- Delivery: reward verified bytes received in time for playback.
- Availability/storage: reward successful unpredictable retrieval challenges for content-addressed chunks.
- Integrity checking: part of normal playback; only a confirmed, useful corruption report may earn a separate bounty.

Timeouts and ordinary packet loss must not be slashable. Slashing should require cryptographic evidence that a helper supplied data conflicting with the broadcaster's signed integrity manifest.

### 7) Crypto rails settle batches, not individual segments

The creator funds an asset-specific, capped reward pool. Verified contributions accrue in a durable transactional ledger and settle only after a configured threshold. The system must never promise rewards beyond the reserved pool balance.

Initial payout preference:

1. Bitcoin Lightning for frequent, automated, relatively small payouts.
2. Monero for privacy-oriented payouts accumulated above a fee-aware threshold.
3. Bitcoin on-chain only for larger withdrawals.

Existing additional payment rails may continue serving purchases and donations. They should not be advertised for peer payouts until an outbound, idempotent payout adapter and operational funding source exist for that rail.

No new dStream token is desired for the initial system. Reward balances should remain denominated in the asset that funded the pool, avoiding an exchange-rate oracle in the core accounting path.

Nostr Wallet Connect may authorize a broadcaster-controlled Lightning node with a revocable spending budget. Public zap events may provide social acknowledgement, but the payout ledger must use the wallet/node's actual settlement result rather than treating a relay event alone as proof.

### 8) Participation is explicit and user-controlled

The helper experience should be presented as `Relay & Earn` with clear opt-in. Users must be able to set upload bandwidth, disk use, schedules, allowed streams or creators, payout destination, and an immediate stop control.

Reliable background service should run through the desktop/headless node. A browser tab may assist opportunistically while active, but the product must not imply that mobile or suspended browser tabs can provide dependable background service.

### 9) Public-stream control has a clear boundary

The broadcaster can control official admission, client preference, protocol rewards, and access to encrypted streams. The broadcaster cannot prevent an unrelated party from copying and redistributing media that was made publicly accessible outside dStream's protocol.

The UI and documentation must describe this distinction accurately.

## Required Broadcaster UX

Broadcast Studio should provide a `Distribution` section containing:

- mode selection,
- helper selection strategy,
- active-helper limit,
- schedule and demand trigger,
- per-helper and stream-wide resource limits,
- reward asset, rate, pool balance, and hard budget,
- candidate, active, standby, paused, blocked, and expired helper views,
- approve, replace, pause, block, trust, and stop-all actions,
- real delivered-byte, quality, lease, accrued, and paid values.

Controls and telemetry must reflect real enforcement state. Placeholder earnings, synthetic peer counts, and unenforced limits are not acceptable.

## Implementation Order

1. Replace self-issued contribution evidence with receiver-signed delivery receipt v2.
2. Add signed policy revisions, relay leases, revocation, and admission enforcement.
3. Add a transactional reward ledger with replay protection, reservations, and payout idempotency.
4. Add Lightning and Monero outbound payout adapters and funding health checks.
5. Add Broadcast Studio and `Relay & Earn` controls.
6. Test multi-peer delivery, lease expiry, policy changes, budget exhaustion, tampering, replay, self-loop, collusion caps, payout retries, and process restarts.

## Relationship to Existing ADRs

- Refines ADR `0029` by making FCFS optional and adding broadcaster-selected admission, schedules, limits, and leases.
- Extends ADRs `0022` and `0025`; their current stake/refund mechanism remains distinct until receipt v2 and the reward ledger are implemented.
- Reuses ADR `0020` integrity manifests as the source of truth for delivered content.
- Extends ADR `0031` with outbound payout behavior; existing inbound settlement verification alone is not a payout engine.

## Open Defaults

Implementation must choose and test defaults for lease duration, renewal timing, helper count, delivery-receipt interval, minimum payout, reward rate, challenge frequency, service-quality thresholds, and collusion caps. These are deployment policy values, not protocol constants, unless a later ADR establishes otherwise.

## Consequences

- Streamers retain practical control over who officially carries their media, how many helpers participate, when participation occurs, and what it can cost.
- Helpers receive transparent authorization, limits, accounting, and payout terms before donating resources.
- The design avoids per-segment blockchain transactions and avoids treating self-reported work as payable proof.
- Admission and accounting remain origin/coordinator enforced and are not fully trustless; that boundary must remain explicit.
- Monetary launch requires adversarial tests and durable accounting beyond the current P2P telemetry and refund prototype.
