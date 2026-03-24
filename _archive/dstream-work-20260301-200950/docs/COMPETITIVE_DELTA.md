# dStream vs zap.stream — Technical Delta

Last updated: 2026-02-19

## Scope

This document captures a practical engineering comparison between:

- **dStream** (current `.dstream-work` implementation)
- **zap.stream** (public repository snapshot and observed product behavior)

It is intentionally technical and implementation-oriented (not marketing copy).

## Summary

- zap.stream is a strong **Nostr + Lightning live-stream client** with established network reach.
- dStream is ahead on **rebroadcast architecture** (P2P assist + queue/economy controls), **Monero-first verified flows**, and **operator hardening/deploy gates**.
- The two products overlap on Nostr-based discovery/chat/watch, but diverge on media transport and payment rails strategy.

## Evidence Basis

### zap.stream repository evidence

- NIP-53 client declaration:  
  `https://github.com/v0l/zap.stream/blob/master/README.md`
- Stream editor enforces HLS URL shape:  
  `https://github.com/v0l/zap.stream/blob/master/src/element/stream-editor/index.tsx`
- Live player uses HLS pipeline:  
  `https://github.com/v0l/zap.stream/blob/master/src/element/stream/live-video-player.tsx`
- RTMP forwarding targets (YouTube/Facebook/etc):  
  `https://github.com/v0l/zap.stream/blob/master/src/element/provider/nostr/fowards.tsx`

### dStream repository evidence

- Host mode + rebroadcast threshold in watch path logic:  
  `/Users/erik/Projects/JRNY/.dstream-work/apps/web/app/watch/[pubkey]/[streamId]/page.tsx`
- Presence + queue participation model:  
  `/Users/erik/Projects/JRNY/.dstream-work/apps/web/src/hooks/useStreamPresence.ts`
- Monero stake/tip/escrow API surfaces:  
  `/Users/erik/Projects/JRNY/.dstream-work/apps/web/app/api/xmr/`
- Production hardening/runtime gate scripts:  
  `/Users/erik/Projects/JRNY/.dstream-work/scripts/harden-check.mjs`  
  `/Users/erik/Projects/JRNY/.dstream-work/scripts/gate-production.sh`

## Feature Delta Matrix

| Area | dStream (current) | zap.stream (observed) |
|---|---|---|
| Discovery/identity substrate | Nostr-based discovery + identity; npub-facing routes | Nostr-based discovery + identity |
| Core stream metadata | Extended announce fields incl. host mode, thresholds, payment methods | NIP-53-centric announce model |
| Watch transport | WHEP-first + HLS fallback + optional P2P assist datachannel | Primarily HLS playback path |
| Broadcaster ingest | WHIP proxy + origin path model | External/manual hosting model centered on RTMP/HLS |
| Viewer-to-viewer rebroadcast | Implemented FCFS active/standby queue + assist policy controls | Not observed as first-class feature |
| Host economics policy | `host_only` vs `p2p_economy`, rebroadcast threshold, waiver logic | Not observed with equivalent queue/economy controls |
| Payments rails | Multi-asset addresses + wallet links; **Monero verified backend** | Lightning/Zaps are primary |
| Verified settlement backend | XMR tip/stake/escrow-v3 server flows | Zap/Lightning ecosystem flows |
| Moderation model | App-surface moderation + report queue + operator controls | Existing Nostr ecosystem moderation patterns |
| Deployment hardening | Built-in preflight + runtime smoke + production gate scripts | Not a direct apples-to-apples operator gate set in product repo |

## Important Nuance

- “Better” depends on product objective:
  - If target is **Lightning-native social streaming liquidity**, zap.stream has ecosystem maturity.
  - If target is **Monero-first economy + explicit rebroadcast policy controls**, dStream currently differentiates more clearly.

## Known Limits of This Comparison

- zap.stream evolves quickly; conclusions are “as inspected” on 2026-02-19.
- This matrix compares surfaced behavior and repository evidence, not private infrastructure details.

