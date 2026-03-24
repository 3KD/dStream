function uniq(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

export function getWebRtcIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS?.trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const allStrings = parsed.every((v) => typeof v === "string");
        if (allStrings) {
          return uniq(parsed as string[])
            .map((u) => u.trim())
            .filter(Boolean)
            .map((u) => ({ urls: u }));
        }

        const allObjects = parsed.every((v) => v && typeof v === "object");
        if (allObjects) {
          return parsed as RTCIceServer[];
        }
      }
    } catch {
      // fall back to CSV
    }
  }

  return uniq(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ).map((u) => ({ urls: u }));
}

export function getDefaultRtcConfig(): RTCConfiguration {
  const iceServers = getWebRtcIceServers();
  if (iceServers.length) return { iceServers };

  // Default STUN pool for local development and smoke stability.
  // Production should override with NEXT_PUBLIC_WEBRTC_ICE_SERVERS.
  return {
    iceServers: [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };
}
