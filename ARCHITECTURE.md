# Architecture: Ownerless P2P Live Streaming

## Component Map

### 1. Broadcaster (Streamer)
- **Role**: Source of the live stream.
- **Tools**: OBS Studio (Ingest via RTMP).
- **Actions**:
  - Pushes RTMP stream to **Ingest Server**.
  - Signs `STREAM_ANNOUNCE` message.

### 2. Ingest & Packaging Server (MediaMTX / SRS)
- **Role**: Transcoding and Packaging.
- **Functions**:
  - Accepts RTMP ingest.
  - Transcodes to HLS (multiple renditions).
  - Outputs HLS playlists (.m3u8) and Segments (.ts/.m4s).
  - (Future) Integrates with **Manifest Service** to sign segment hashes.

### 3. Manifest Service (Signing Layer)
- **Role**: Cryptographic integrity generator.
- **Functions**:
  - Monitors generated segments.
  - Computes SHA-256 of segments.
  - Signs `MANIFEST_ROOT` with Creator's Private Key.
  - Publishes `MANIFEST_ROOT` to distribution layer (HTTP/Relays).

### 4. Origin / Distribution
- **Role**: Reliable HTTP source.
- **Functions**:
  - Hosts HLS Playlists and Segments.
  - Fallback for P2P network.
  - Can be a simple Web Server (Nginx) or Object Storage (MinIO).

### 5. Swarm Signaling (Trackers)
- **Role**: Peer discovery.
- **Type**: WebTorrent-compatible trackers.
- **Functions**:
  - Connects viewers watching the same stream/rendition.
  - Examples: `wss://tracker.openwebtorrent.com`.

### 6. Web Client (Viewer)
- **Role**: Playback and P2P participation.
- **Tech Stack**:
  - **Player**: hls.js
  - **P2P**: @peertube/p2p-media-loader-hlsjs (or Novage).
  - **Logic**:
    - Fetches `MANIFEST_ROOT` and verifies signature.
    - Loads segments via P2P if available, else HTTP.
    - Verifies segment hashes.
  - **Tipping**: Reown AppKit / WebLN.

## Data Flow

1.  **Ingest**: OBS -> [RTMP] -> MediaMTX
2.  **Processing**: MediaMTX -> [Disk/Mem] -> HLS Segments
3.  **Signing**: Manifest Service -> [Read Segments] -> Sign `MANIFEST_ROOT`
4.  **Announce**: Broadcaster -> [Sign] -> `STREAM_ANNOUNCE` -> Origins/Relays
5.  **Playback (Viewer)**:
    - Get `STREAM_ANNOUNCE`.
    - Join Swarm via **Trackers**.
    - Get `MANIFEST_ROOT`.
    - Download Segment (P2P <-> Peers) OR (HTTP <-> Origin).
    - Verify Hash.
    - Play.

## Ownerless Properties
- **Identity**: Public Key (Ed25519).
- **Discovery**: Decentralized (via Hints in Announce).
- **Trust**: Rooted in Signatures, not Server Domains.
