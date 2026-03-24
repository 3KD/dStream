# ADR 0008: P2P UX Only When Real

- Status: Accepted
- Date: 2026-02-04

## Context

Showing P2P “health” UI while stats are stubbed or not wired end-to-end creates misleading UX and erodes trust.

## Decision

Display P2P telemetry only when:

- The P2P engine is enabled, initialized, and connected to the player.
- Stats are populated from real engine data.

P2P controls may be visible in disabled state when prerequisites are missing (for example, stake-gated streams without verified stake), but must include an explicit reason.

## Consequences

- The UI reflects reality and reduces confusion.
- Users can still see that P2P exists by default without mistaking unavailable telemetry for active P2P.
- Feature flags become first-class for Phase 2 work.
