# 🛰️ dStream

> **Ownerless, Peer-to-Peer, Privacy-Centric Live Streaming.**

dStream is a decentralized streaming protocol and application that puts power back into the hands of creators and viewers. By combining **P2P HLS delivery**, **Nostr-based metadata**, and **Monero-native monetization**, dStream eliminates the need for central authorities, platform fees, and censorship.

---

## 🚀 Vision

Platforms like Twitch and YouTube own your audience. They can de-platform you, shadow-ban you, and take a 50% cut of your revenue. **dStream is different.**

- **No Central Server:** Video segments are distributed via P2P relaying, dramatically reducing infrastructure costs.
- **Permanent Metadata:** Your stream name, bio, and status are stored on the Nostr network.
- **True Privacy:** Payments happen over Monero (XMR), ensuring no one knows who tipped whom.

---

## ✨ Key Features

*   📺 **P2P HLS Streaming**: High-definition video delivery that scales with your audience.
*   🛡️ **Decentralized Discovery**: Uses NIP-34 style Nostr events for stream announcements.
*   💰 **Monero Staking & Tipping**: Support creators directly with XMR without any middleman.
*   ⚡ **WHIP/WHEP Native**: Compatible with professional OBS setups and browser-based broadcasting.
*   🤝 **Trustless Escrow**: Built-in anti-leeching mechanisms using cryptographic stakes.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 16, Tailwind CSS, Lucide Icons
- **Video Stack**: MediaMTX, HLS.js, [P2P-Media-Loader](https://github.com/Novage/p2p-media-loader)
- **Networking**: Nostr (`nostr-tools`), WebRTC (WHIP/WHEP)
- **Economy**: Monero (XMR)
- **Infrastructure**: Docker & Docker Compose

---

## 🚥 Quick Start

### 1. Prerequisites
- [Docker & Docker Compose](https://www.docker.com/products/docker-desktop/)
- A Monero Wallet (e.g., [Cake Wallet](https://cakewallet.com/), [GUI](https://www.getmonero.org/downloads/))
- A Nostr Identity (Generated automatically in-app)

### 2. Launch the Stack
```bash
# Clone the repository
git clone https://github.com/3KD/dStream.git
cd dStream/infra/stream

# Bring up the services
docker-compose up -d
```

### 3. Access
- **Web UI**: [http://localhost:5656](http://localhost:5656)
- **Broadcaster**: [http://localhost:5656/broadcast](http://localhost:5656/broadcast)

---

## 📂 Project Structure

- `apps/web`: The Next.js frontend and main application logic.
- `services/manifest`: Segment signing and verification service.
- `infra/stream`: Local development and streaming server configuration.
- `infra/prod`: Production deployment scripts and configurations.

---

## 🛡️ Trustless Staking

dStream implements a unique **Escrow/Staking** flow using Monero subaddresses. Viewers provide a small "anti-leech" stake to verify their humanity, which can be released or claimed based on stream integrity. No smart contracts required—just pure peer-to-peer verification.

---

## 📜 License

dStream is open-source and ownerless. Feel free to fork, contribute, or host your own node.

---

### 📡 Join the Stream
*Built for the creators of tomorrow.*
