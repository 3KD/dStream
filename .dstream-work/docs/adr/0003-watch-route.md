# ADR 0003: Watch Route Encodes Stream Identity

- Status: Accepted
- Date: 2026-02-04

## Context

Guessing identity from a single route segment or query params causes incorrect resolution and makes deep links unstable.

## Decision

Use an explicit watch route:

- `/watch/:pubkey/:streamId`

The route is the source of truth for playback context (chat scope, presence scope, etc.).

## Consequences

- Links from discovery/browse/search must generate this route.
- Any legacy “/watch/:channel” or `?pubkey=` patterns are removed or redirected.

