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
* Click **Ban** to publish a channel moderation action. Compatible clients hide that viewer's messages; it does not delete them from third-party relays.
* Use the `/w [Npub]` command in chat to securely decrypt and whisper private messages to moderators or trusted community members.

---

## 2. Going Live: The Broadcast Studio

1. Navigate to the **Broadcast** tab.
2. You have native access to push **WebRTC** directly out from your browser using your Macbook/PC microphone and webcam inputs.
3. Once active, the system automatically packages a secondary **HLS (HTTP Live Streaming)** index stream in the background. If a viewer connects on a poor cellular connection and cannot assist the P2P swarm via WebRTC, they will seamlessly fallback to your HLS origin track to ensure constant playback without buffering.

---

### Livestream thumbnails

In Broadcast advanced settings, choose automatic capture, upload a cover or enter
a public HTTPS image URL. Recommended size is 1280 x 720 (16:9); JPEG/PNG/WebP
uploads may be up to 8 MiB. Custom covers remain until explicitly replaced or
returned to automatic mode. With no custom cover, the first decodable video
produces a stored 16:9 JPEG. Pending/failed ingest shows a logo and retries.

Thumbnails are public even for private streams. Choose **No public thumbnail**
before going live if that is not acceptable.
Private video is not automatically captured unless you explicitly allow a public
frame in the thumbnail controls; you can instead supply a nonsensitive cover.
For an existing stream missing a cover, reopen Broadcast with the same identity
and stream ID and republish its
status. The shared Nostr image tag supplies compatible clients, including
zap.stream; third-party caches may delay changes. See
[the full lifecycle and release limits](STREAM_THUMBNAILS.md).

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
3. Click the alert to attach a **Pricing Package**. You can require a verified Monero (XMR) payment before dStream grants access through a scoped playback token.

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
