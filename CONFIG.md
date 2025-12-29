# Configuration & Constants

## Tracker List (Community Defaults)
Clients should try these in parallel, plus any specific `tracker_hints` from the stream announcement.

1. `wss://tracker.openwebtorrent.com`
2. `wss://tracker.btorrent.xyz`
3. `wss://tracker.webtorrent.dev`
4. `wss://tracker.files.fm:7073/announce`

## Protocol Constants
- **HLS Segment Duration**: 4 seconds (Balance between P2P efficiency and latency).
- **Epoch Window**: 3 segments (~12 seconds).
- **Hash Algorithm**: SHA-256.
- **Signature Algorithm**: Ed25519 (Libsodium/Noble).

## Network defaults
- **Ingest Port (RTMP)**: 1935
- **HLS Output Port**: 8888 (MediaMTX default)

## Tipping Configuration
- **Supported Namespaces**:
  - `eip155` (EVM)
  - `solana`
  - `bip122` (Bitcoin)
- **Recommended Wallets**:
  - Reown AppKit (formerly WalletConnect) default set.
