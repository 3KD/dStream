# ADR 0004: Single Protocol Module for Encode/Decode

- Status: Accepted
- Date: 2026-02-04

## Context

Ad-hoc tag parsing and event construction scattered across UI code leads to drift and signature/canonicalization mistakes.

## Decision

Create a dedicated protocol package (e.g. `packages/protocol`) that owns:

- Event builders (announce, chat, presence, etc.)
- Tag schemas and validation
- Parsers that convert Nostr events into typed domain objects
- Canonicalization rules for any signed payloads

Application code must not manually interpret tags beyond calling the protocol package.

## Consequences

- Fewer “stringly typed” bugs and easier refactors.
- Protocol changes become explicit versioned edits.

