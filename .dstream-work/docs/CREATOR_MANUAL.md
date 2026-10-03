# Creator Manual

This manual covers the canonical dStream runtime. It does not require creators to operate payment RPC services unless they also run the dStream node.

## 1. Identity

1. Open Settings.
2. Connect a NIP-07 extension, import an existing key, or generate a local Nostr identity.
3. Back up the private key securely. dStream cannot recover it.
4. Never send a private key or wallet seed through chat or support.
5. Publish your display name, image, and bio to the configured relays.

Your key is portable, but individual relays can reject or omit events. Use more than one relay.

## 2. Browser Broadcast

1. Open Broadcast and select the browser source.
2. Allow only the camera, microphone, or screen permissions you need.
3. Confirm preview, title, visibility, topics, chat policy, and payout methods.
4. Start the broadcast.
5. Wait for Media Signal and Announce status to confirm before sharing the watch link.
6. End the stream from Broadcast Studio so the latest kind `30311` event records `status=ended`.

## 3. OBS or Another Encoder

1. Select OBS / Encoder in Broadcast Studio.
2. Copy the displayed server and stream key into a Custom RTMP service in the encoder.
3. Compatible encoders may use the displayed WHIP endpoint instead.
4. Start the encoder and wait for dStream to detect media.
5. Keep Broadcast Studio open long enough to publish and refresh the live announcement.

## 4. Discovery and Playback

- Public discovery comes from signed kind `30311` announcements.
- A direct watch route is identified by creator public key and stream ID.
- The media origin ingests and seeds the stream.
- WHEP is used where viable; HLS supplies compatibility and recovery.
- Optional viewer assist exchanges requested HLS bytes over WebRTC. It can reduce repeated origin delivery, but it does not increase encoder resolution or bitrate.
- If a direct watch route works but Browse does not, check relay acceptance and republish the current announcement before changing the media pipeline.

## 5. Payments

1. Add creator-controlled payout destinations in Settings -> Wallet Integrations.
2. Verify each address in its actual wallet before publishing it.
3. Apply the desired payout methods in Broadcast Studio.
4. dstream.stream currently exposes verified Monero, Bitcoin Lightning, and Bitcoin on-chain payments.
5. Viewers initiate payment through their own wallet; dStream does not store either party's wallet keys.

Node operators configure wallet RPC, chain RPC, indexers, provider API keys, and settlement storage. Ordinary creators should never paste those credentials into public fields. Privacy depends on the rail: Monero is private by default; public-ledger payments are not.

## 6. Moderation

- Local mute/block controls affect your client.
- Signed stream moderation and role events apply through clients that recognize and authorize them.
- Official discovery moderation can hide content from dStream's indexed surfaces but cannot delete events from third-party relays.
- Relay delivery and deletion support vary; do not describe a moderation action as erasing data from the network.

See the in-app `/docs`, repository `PROTOCOL.md`, and `CONFIG.md` for technical details.
