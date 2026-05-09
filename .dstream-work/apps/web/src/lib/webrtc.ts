function uniq(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

function normalizeIceUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const match = /^(stun|turns?):(.+)$/i.exec(value);
  if (!match) return null;

  const body = match[2] ?? "";
  const [hostPort] = body.split("?", 1);
  if (!hostPort) return null;

  let host = hostPort;
  let port: string | null = null;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close <= 1) return null;
    host = hostPort.slice(0, close + 1);
    const rest = hostPort.slice(close + 1);
    if (rest) {
      if (!rest.startsWith(":")) return null;
      port = rest.slice(1);
    }
  } else {
    const colon = hostPort.lastIndexOf(":");
    if (colon >= 0) {
      host = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    }
  }

  if (!host || /\s/.test(host)) return null;
  if (port !== null) {
    if (!/^\d+$/.test(port)) return null;
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
  }

  return value;
}

function normalizeIceServer(input: unknown): RTCIceServer | null {
  if (typeof input === "string") {
    const url = normalizeIceUrl(input);
    return url ? { urls: url } : null;
  }
  if (!input || typeof input !== "object") return null;

  const candidate = input as Partial<RTCIceServer>;
  const rawUrls = Array.isArray(candidate.urls) ? candidate.urls : [candidate.urls];
  const urls = uniq(rawUrls.map(normalizeIceUrl).filter((url): url is string => !!url));
  if (urls.length === 0) return null;

  return {
    ...candidate,
    urls: urls.length === 1 ? urls[0] : urls
  } as RTCIceServer;
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
          return (parsed as string[])
            .map(normalizeIceServer)
            .filter((server): server is RTCIceServer => !!server);
        }

        const allObjects = parsed.every((v) => v && typeof v === "object");
        if (allObjects) {
          return parsed.map(normalizeIceServer).filter((server): server is RTCIceServer => !!server);
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
  )
    .map(normalizeIceServer)
    .filter((server): server is RTCIceServer => !!server);
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
