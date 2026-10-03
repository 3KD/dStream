const DEFAULT_STUN_SERVERS = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302"
];

const TURN_REFRESH_SKEW_MS = 60_000;
const TURN_FETCH_TIMEOUT_MS = 1_500;

type TurnCache = {
  iceServers: RTCIceServer[];
  expiresAtMs: number;
};

let turnCache: TurnCache | null = null;
let turnRequest: Promise<TurnCache | null> | null = null;

function uniq(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

function serverUrls(server: RTCIceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

function isTurnServer(server: unknown): server is RTCIceServer {
  if (!server || typeof server !== "object") return false;
  const candidate = server as RTCIceServer;
  const urls = serverUrls(candidate);
  if (urls.length === 0 || urls.some((url) => typeof url !== "string" || !/^turns?:/i.test(url))) return false;
  return typeof candidate.username === "string" && typeof candidate.credential === "string"
    && candidate.username.length > 0 && candidate.credential.length > 0;
}

export function parsePublicStunServers(raw: string | undefined): RTCIceServer[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];

  let entries: unknown[];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      entries = value.split(",");
    }
  } else {
    entries = value.split(",");
  }

  const urls = entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => /^stun:[^\s@]+$/i.test(entry));

  return uniq(urls).map((url) => ({ urls: url }));
}

export function getPublicStunServers(): RTCIceServer[] {
  const configured = parsePublicStunServers(process.env.NEXT_PUBLIC_WEBRTC_STUN_SERVERS);
  return configured.length > 0 ? configured : DEFAULT_STUN_SERVERS.map((urls) => ({ urls }));
}

export function getDefaultRtcConfig(): RTCConfiguration {
  return { iceServers: getPublicStunServers() };
}

async function fetchTurnCache(opts?: {
  fetcher?: typeof fetch;
  nowMs?: number;
}): Promise<TurnCache | null> {
  const fetcher = opts?.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/webrtc/ice-servers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });
    if (!response.ok) return null;

    const body = await response.json() as { iceServers?: unknown; expiresAt?: unknown };
    const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : Number.NaN;
    const iceServers = Array.isArray(body.iceServers) ? body.iceServers.filter(isTurnServer) : [];
    const nowMs = opts?.nowMs ?? Date.now();
    const expiresAtMs = expiresAt * 1000;
    if (iceServers.length === 0 || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs + TURN_REFRESH_SKEW_MS) {
      return null;
    }
    return { iceServers, expiresAtMs };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getResolvedRtcConfig(opts?: {
  fetcher?: typeof fetch;
  nowMs?: number;
}): Promise<RTCConfiguration> {
  const nowMs = opts?.nowMs ?? Date.now();
  if (!turnCache || turnCache.expiresAtMs <= nowMs + TURN_REFRESH_SKEW_MS) {
    turnRequest ??= fetchTurnCache(opts).finally(() => {
      turnRequest = null;
    });
    const refreshed = await turnRequest;
    if (refreshed) turnCache = refreshed;
  }

  const dynamicTurn = turnCache && turnCache.expiresAtMs > nowMs + TURN_REFRESH_SKEW_MS
    ? turnCache.iceServers
    : [];
  return { iceServers: [...getPublicStunServers(), ...dynamicTurn] };
}

export function resetWebRtcIceServerCacheForTests(): void {
  turnCache = null;
  turnRequest = null;
}
