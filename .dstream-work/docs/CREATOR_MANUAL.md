# Creator Manual: Mastering dStream

dStream is not a traditional platform. You are not broadcasting to a central server that artificially limits your reach, throttles your video quality, or skims a percentage of your revenue. 

You are launching a decentralized origin node. When a viewer connects, their browser natively joins a P2P swarm, directly helping you relay your live broadcast across the world. No platform fees, no censorship, absolute scale.

Here is your manual for mastering the economic and technical controls.

---

## 1. Establishing Independence: Your Nostr Identity

dStream relies on **Nostr** to route your Chat and authenticate your identity. You do not log in with a traditional email and password.

### Creating your Keys
1. Navigate to your **Settings** icon.
2. Select **Generate Identity**. This will produce a mathematical keypair. 
3. **CRITICAL**: Backup your Private Key. This is the only way to prove you own your account, your community reputation, and your channel handle. dStream does not have a "Forgot Password" button because the network is entirely decentralized.

### Protecting Your Community
Because there is no central corporation to ban bad actors, moderation is localized to your channel:
* Click on a viewer's profile in Chat and click **Mute** to shield them from your view.
* Click **Ban** to mathematically discard their messages from the relay entirely so no other viewers see them.
* Use the `/w [Npub]` command in chat to securely decrypt and whisper private messages to moderators or trusted community members.

---

## 2. Going Live: The Broadcast Studio

1. Navigate to the **Broadcast** tab.
2. You have native access to push **WebRTC** directly out from your browser using your Macbook/PC microphone and webcam inputs.
3. Once active, the system automatically packages a secondary **HLS (HTTP Live Streaming)** index stream in the background. If a viewer connects on a poor cellular connection and cannot assist the P2P swarm via WebRTC, they will seamlessly fallback to your HLS origin track to ensure constant playback without buffering.

---

## 3. The Video Library: Uploads & Monetization

dStream acts as a full YouTube competitor. You do not have to just stream live; you can natively upload and distribute traditional Videos and packaged video content.

### Using the Operator Console
1. Navigate to **Settings -> Operator Console -> Video Library**.
2. From the ingest tab, you can drag and drop raw MP4s onto your broadcast node.
3. You can curate Playlists, tag your videos natively for the global index, and arrange the playback sequences.

### Activating the Paywall (Private Pricing Gaps)
You can directly monetize your raw uploads.
1. In your **Video Library**, select a batch of files and mark them as **Private / Published**.
2. The UI will instantly warn you of a *Private Pricing Gap*.
3. Click the alert to automatically attach a **Pricing Package**. You can require viewers to cryptographically tip an exact amount of Monero (XMR) before the network hands them the decryption keys to unlock your video.

---

## 4. Unstoppable Economics: Monero Tipping

With dStream, there is no banking middle-man tracking your community's generosity.

1. Ensure your node's `xmr-wallet-rpc` is securely firing on your droplet.
2. Viewers who click the orange **Drop Tip** button in your live chat will pop open a Monero QR Code modal.
3. The server securely maps an ephemeral Subaddress physically to your active stream.
4. When a user scans the QR code and submits the drop, the network will ping the daemon. Once the mempool detects 0-confirmations, the UI shifts to *Pending*.
5. Complete verification explodes into a visual pop-up inside your chat for the entire audience to see. 100% of the value routes directly to your cold storage layer without a single central fee.

---
Welcome to Uncensorable Media.
