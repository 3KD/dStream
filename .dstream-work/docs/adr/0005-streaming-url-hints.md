# ADR 0005: Streaming URL Is a Hint, Not Authority

- Status: Accepted
- Date: 2026-02-04

## Context

To be “ownerless”, clients must treat delivery endpoints as replaceable hints. Publishing `localhost` or other non-routable URLs breaks discovery and creates confusion between dev and prod behavior.

## Decision

In kind:30311 announce events:

- A `streaming` tag (or equivalent field) is treated as a **hint**.
- Hints must be **publicly reachable** for production use.
- The broadcaster must never publish `localhost` / RFC1918 URLs as production hints.

Client fallback rules:

- If a valid streaming hint exists, try it first.
- If absent/unreachable, fall back to configured defaults (same-origin proxy in dev, or explicit configured origin in prod).

## Consequences

- Better linkability and fewer “it works on my machine” announces.
- Forces explicit configuration for production deployment.

