# dStream Broadcasting Guide: Running a Sovereign Node

dStream is a decentralized broadcasting platform. Unlike Twitch or YouTube, there is no central server. **You are the broadcaster.** Your computer (or server) is the station.

## Architecture: "The Phonebook vs. The Call"

To understand how dStream works, think of the distinction between a Phonebook and a Phone Call.

### 1. The Phonebook (Global & Public)
*   **What it is:** The list of who is live, their stream title, and how to find them.
*   **Technology:** **Nostr**.
*   **Decentralization:** When you click "Go Live", your node publishes a signed announcement to public Nostr relays (like `relay.snort.social`).
*   **Result:** Anyone on the dStream network instantly sees you are live in their "Browse" feed.

### 2. The Call (Peer-to-Peer)
*   **What it is:** The actual video data.
*   **Technology:** **MediaMTX (RTMP/HLS) + WebRTC**.
*   **Decentralization:** Your node becomes a mini-server. Viewers connect **directly to you** (or to peers who are connected to you) to fetch video segments.

## Making Your Node Reachable

Because you are the server, viewers need to be able to reach your node.

### Scenario A: Cloud Server (VPS)
If you deploy dStream on a VPS (like DigitalOcean, AWS, or Hetzner) with a public IP:
*   **It just works.**
*   The IP address in your Nostr announcement is public, and viewers can connect directly.

### Scenario B: Home Computer (Behind WiFi/NAT)
If you run dStream on your laptop at home:
*   **Problem:** Viewers cannot connect to `192.168.x.x` (your local IP).
*   **Solution:** You need a **Tunnel** to give your local node a public address.

#### Recommended: Cloudflare Tunnel (Free)

1.  **Install `cloudflared`**:
    ```bash
    brew install cloudflared  # macOS
    ```
2.  **Start a Tunnel**:
    Run this command to expose your local HTTPS port (5656):
    ```bash
    cloudflared tunnel --url https://localhost:5656
    ```
3.  **Update dStream**:
    *   Copy the URL provided by Cloudflare (e.g., `https://cold-breeze-123.trycloudflare.com`).
    *   Open dStream Dashboard > **Settings**.
    *   Set **"Public Node URL"** to your Tunnel URL.

Now, when you Go Live, your announcement will tell the world to find you at `https://cold-breeze-123...`. Viewers will connect to that URL, which tunnels securely to your laptop.

## Advanced: Port Forwarding
Alternatively, you can forward ports `8880` (HLS) and `8889` (WebRTC) on your router to your laptop's static IP. This requires no external services but exposes your home IP address.
