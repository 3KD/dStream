# ADR 0029: Rebroadcast Queue and Hosting Economy Modes

- Status: Accepted
- Date: 2026-02-13

## Context

The decentralization goal requires that creators and communities can operate without mandatory dependence on a single dStream-operated host.

At the same time, hosting operators need explicit control over monetization:

- some operators want to maximize decentralization by rewarding peer rebroadcasting,
- some operators want to run fully hosted delivery and collect delivery fees directly.

We also need safe anti-abuse controls so any incentive model cannot be trivially farmed by low-quality or sybil peers.

## Decision

### 1) Two explicit host modes

Every stream host can choose one of two policy modes:

1. **P2P Economy mode**  
   Rebroadcasting is allowed and can earn fee waivers/credits.
2. **Host-Only mode**  
   No rebroadcast waivers are granted; host can fully deliver and collect hosting fees.

This mode is host-configurable per stream.

### 2) Capacity-threshold admission model

In P2P Economy mode, rebroadcaster admission uses:

- an active set size threshold `T`,
- first-come-first-serve admission into the active set until `T` is full,
- a standby queue after `T` is reached.

When an active rebroadcaster drops, fails quality checks, or is removed, the next queued peer is promoted automatically.

### 3) Fee waiver/credit policy

Rebroadcasting incentives are based on verified contribution, not just connection presence.

Only active rebroadcasters that meet minimum service thresholds can receive:

- free viewership windows, and/or
- hosting fee credits.

Threshold examples (policy-driven): served bytes, sustained uptime, and minimum QoS.

### 4) Safety and anti-gaming requirements

All economic rewards must be gated by anti-abuse controls:

- stake/bond requirement for rebroadcast admission,
- identity and session scoping,
- signed contribution receipts,
- anti-sybil and anti-self-loop checks,
- eviction on repeated quality failures.

### 5) Independence-by-default policy target

Product policy target is independence-by-default:

- no mandatory reliance on a dStream-operated host,
- host dependency must be explicit, optional, and billable.

## Consequences

- Introduce host policy configuration for mode selection and thresholds.
- Implement active/queue assignment state machine and promotion/eviction behavior.
- Implement contribution accounting and fee-credit settlement rules.
- Add receipt verification, anti-abuse checks, and moderation hooks for queue safety.
- Add explicit UX copy so users know when they are:
  - in Host-Only mode,
  - in P2P Economy mode,
  - queued vs active rebroadcast peers,
  - eligible vs ineligible for fee waivers.
- Add smoke/integration tests for:
  - FCFS admission and queue rollover,
  - drop-out replacement,
  - waiver eligibility and denial paths,
  - abuse/failure eviction paths.
