# ADR 0019: P2P Discovery / Signaling Model (Nostr Relays)

- Status: Accepted
- Date: 2026-02-06

## Context

JRNY’s protocol docs describe a tracker/WebTorrent-style swarm discovery model (tracker hints and “announce to trackers” behavior).

The rebuild shipped a working P2P delivery path already:

- HLS segment peer-assist via a custom `hls.js` fragment loader
- WebRTC datachannels between viewers
- Signaling transported over Nostr relays (custom kind `8108`)

We must pick a **canonical** discovery/signaling model so we can implement integrity + staking without rewriting the P2P layer mid-stream.

## Decision

For v3 “JRNY parity / everything” the canonical P2P discovery/signaling layer is:

- **Nostr-relay signaling** (custom kind `8108`) + WebRTC datachannels
- **Presence-derived peer selection** (watchers publish presence; viewers connect to a bounded set of active peers)

Trackers / WebTorrent signaling are **not required** for v1 “everything” completion, and are explicitly treated as a potential later enhancement if we decide to ship a second P2P backend.

## Consequences

- The rebuild’s P2P path remains decentralized in the same way discovery is: relays are configurable and self-hostable.
- Protocol docs must reflect reality: the swarm’s “discovery hints” are relay-driven, not tracker-driven.
- Future tracker/WebTorrent support (if desired) must be implemented as a **separate backend** with clear UX and test coverage (not a silent behavior change).

