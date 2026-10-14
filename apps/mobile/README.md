# dStream Mobile App (Planned)

This directory is reserved for the Native Mobile Application (iOS/Android).

## Tech Stack
- **Framework**: React Native (via Expo)
- **Player**: `expo-av` or `react-native-video` (HLS support)
- **WebRTC**: `react-native-webrtc` (for P2P Mesh)
- **Signaling**: Nostr NIP-04 (Same as Web)

## Roadmap
1. Initialize Expo project: `npx create-expo-app .`
2. Port `useNostr` logic to React Native.
3. Build "Watch" screen with HLS player.
4. Build "Broadcast" screen with Camera/Mic access.
