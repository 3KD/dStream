# ADR 0011: Identity Management Prefers NIP-07

- Status: Accepted
- Date: 2026-02-04

## Context

Storing private keys in the application (especially in `localStorage`) increases risk and expands the security surface area.

## Decision

The default identity path is:

- Use a NIP-07 extension (public key + event signing).

Local key generation is allowed for development/testing, but is explicitly treated as “unsafe by default” until a hardened storage story exists (encryption, passphrase, OS keystore, etc.).

## Consequences

- Better security posture for real users.
- Clear separation between “dev mode” and “real identity”.

