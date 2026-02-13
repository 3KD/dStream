# ADR 0012: No Central Registry Service in the Rebuild

- Status: Accepted
- Date: 2026-02-04

## Context

A separate HTTP “registry” reintroduces a central point of failure and overlaps with Nostr’s role for discovery/metadata.

## Decision

The rebuild repo does not include a central registry service for listing streams.

If an optional aggregator is ever added, it must have a clearly documented role (e.g., caching/UX acceleration) and must not be required for basic discovery.

## Consequences

- Simpler architecture aligned with the “ownerless” goal.
- Prevents accidental dependency on a centralized component.

