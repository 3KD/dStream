import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getWebRtcIceServers } from "./webrtc";

const previousIceServers = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;

afterEach(() => {
  if (previousIceServers === undefined) {
    delete process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;
  } else {
    process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS = previousIceServers;
  }
});

test("getWebRtcIceServers filters malformed ICE URLs before RTCPeerConnection sees them", () => {
  process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS = JSON.stringify([
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "turn:turn.example.com:abc?transport=udp", username: "bad", credential: "bad" },
    {
      urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:70000?transport=tcp"],
      username: "user",
      credential: "pass"
    }
  ]);

  assert.deepEqual(getWebRtcIceServers(), [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "turn:turn.example.com:3478?transport=udp", username: "user", credential: "pass" }
  ]);
});

test("getWebRtcIceServers parses comma-separated ICE URLs and drops invalid ports", () => {
  process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS =
    "stun:stun.l.google.com:19302,turn:turn.example.com:?transport=udp,turn:turn.example.com:3478?transport=tcp";

  assert.deepEqual(getWebRtcIceServers(), [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:turn.example.com:3478?transport=tcp" }
  ]);
});
