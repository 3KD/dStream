# ADR 0028: Mobile App Distribution and Node Model

- Status: Accepted
- Date: 2026-02-12

## Context

dStream now has a stable web + edge deployment path. The next requirement is iOS/Android distribution without re-centralizing the system.

The requested target is “mobile app with server and P2P included, independently runnable.” Platform constraints matter:

- iOS does not allow a long-running general-purpose media server stack like Docker/MediaMTX in-app.
- Android can run more background workloads, but behavior is still power-policy constrained and inconsistent across vendors.
- WHIP/WHEP + HLS origin services are still required for reliable broadcast ingress and viewer fallback.

## Decision

Adopt a two-part mobile model:

1. **Native app distribution (iOS + Android)**  
   Ship a native mobile app wrapper for the existing web runtime and protocol stack (identity, Nostr, chat, presence, P2P assist, wallet UX).

2. **User-owned edge node for ingest/origin**  
   Keep the media seed/origin services on a user-controlled node (VPS/home server), not on the phone.  
   Mobile app connects to that node by configuration and can still watch/participate with P2P assist.

3. **No false “full on-device node” claim**  
   “Independent” means independent from a dStream-operated central server, not that iOS/Android devices run full ingest/origin infrastructure locally.

4. **Operational defaults**
   - App defaults to user-specified relay list and edge endpoint.
   - P2P assist remains opt-in and policy-driven (`any` or `trusted_only`).
   - Wallet and identity remain device-local; server-side verification remains on the user-owned edge node.

## Consequences

- iOS and Android can both ship with consistent functionality and without misleading decentralization claims.
- Core decentralization goal is preserved: no mandatory dStream-owned backend.
- Reliability is improved versus attempting unsupported on-device server behavior.
- Work is split into implementable phases:
  - mobile shell + auth/session flow
  - broadcast/watch API wiring
  - wallet + capability checks
  - deployment profile for user-owned edge node
