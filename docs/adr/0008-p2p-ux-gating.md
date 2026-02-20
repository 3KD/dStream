# ADR 0008: P2P UX Only When Real

- Status: Accepted
- Date: 2026-02-04

## Context

Showing P2P “health” UI while stats are stubbed or not wired end-to-end creates misleading UX and erodes trust.

## Decision

Only display P2P controls/telemetry when:

- The P2P engine is enabled, initialized, and connected to the player.
- Stats are populated from real engine data.

Otherwise, hide the panel or mark it as disabled/experimental behind a feature flag.

## Consequences

- The UI reflects reality and reduces confusion.
- Feature flags become first-class for Phase 2 work.

