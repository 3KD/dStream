import type { Event as NostrEvent } from "nostr-tools";
import { getPool } from "@/lib/nostr";
import { LOCAL_RELAY_URL } from "@/lib/config";
import { getLocalRelay } from "@/lib/relay/localRelay";

async function publishViaRelayWebSocket(relay: string, event: NostrEvent, timeoutMs = 4000): Promise<boolean> {
  if (typeof WebSocket === "undefined") return false;

  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      finish(false);
      return;
    }

    ws.addEventListener("open", () => {
      if (!ws) return;
      try {
        ws.send(JSON.stringify(["EVENT", event]));
      } catch {
        clearTimeout(timer);
        finish(false);
      }
    });

    ws.addEventListener("message", (message) => {
      try {
        const payload = JSON.parse(String(message.data ?? ""));
        if (!Array.isArray(payload)) return;
        if (payload[0] !== "OK") return;
        if (String(payload[1] ?? "") !== event.id) return;
        clearTimeout(timer);
        finish(Boolean(payload[2]));
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });

    ws.addEventListener("close", () => {
      if (done) return;
      clearTimeout(timer);
      finish(false);
    });
  });
}

export interface PublishEventOptions {
  poolTimeoutMs?: number;
  fallbackTimeoutMs?: number;
}

export async function publishEvent(relays: string[], event: NostrEvent, options?: PublishEventOptions): Promise<boolean> {
  // Publish to local relay (fire-and-forget, always succeeds or is a no-op).
  const localRelay = getLocalRelay();
  if (localRelay && relays.includes(LOCAL_RELAY_URL)) {
    localRelay.publish(event);
  }

  const remoteRelays = relays.filter((r) => r !== LOCAL_RELAY_URL);
  if (remoteRelays.length === 0) return !!localRelay;

  const poolTimeoutMs = options?.poolTimeoutMs ?? 15000;
  const fallbackTimeoutMs = options?.fallbackTimeoutMs ?? 4000;

  const pubs = getPool().publish(remoteRelays, event);
  try {
    await Promise.race([
      Promise.any(pubs as any),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Publish timeout")), poolTimeoutMs))
    ]);
    return true;
  } catch {
    const fallbackResults = await Promise.all(
      relays.map((relay) => publishViaRelayWebSocket(relay, event, fallbackTimeoutMs))
    );
    return fallbackResults.some(Boolean);
  }
}

export interface PublishEventReport {
  ok: boolean;
  okRelays: string[];
  failedRelays: Array<{ relay: string; reason: string }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishEventDetailed(
  relays: string[],
  event: NostrEvent,
  opts?: { timeoutMs?: number }
): Promise<PublishEventReport> {
  if (relays.length === 0) throw new Error("No relays configured");
  const timeoutMs = opts?.timeoutMs ?? 5000;

  // Local relay (synchronous, instant).
  const localRelay = getLocalRelay();
  const localResult: Array<{ relay: string; ok: boolean; reason?: string }> = [];
  if (localRelay && relays.includes(LOCAL_RELAY_URL)) {
    const r = localRelay.publish(event);
    localResult.push({ relay: LOCAL_RELAY_URL, ok: r.ok, reason: r.ok ? undefined : r.message });
  }

  const remoteRelays = relays.filter((r) => r !== LOCAL_RELAY_URL);
  if (remoteRelays.length === 0) {
    return {
      ok: localResult.some((r) => r.ok),
      okRelays: localResult.filter((r) => r.ok).map((r) => r.relay),
      failedRelays: localResult.filter((r) => !r.ok).map((r) => ({ relay: r.relay, reason: r.reason ?? "failed" })),
    };
  }

  const pubs = getPool().publish(remoteRelays, event) as any[];

  const results = await Promise.all(
    remoteRelays.map(async (relay, i) => {
      const pub = pubs[i] as Promise<any> | undefined;
      if (!pub) return { relay, ok: false, reason: "missing publish promise" };

      try {
        await Promise.race([pub, sleep(timeoutMs).then(() => Promise.reject(new Error("timeout")))]);
        return { relay, ok: true as const };
      } catch (e: any) {
        return { relay, ok: false as const, reason: e?.message ?? String(e) };
      }
    })
  );

  const allResults = [...localResult, ...results];
  const okRelays = allResults.filter((r) => r.ok).map((r) => r.relay);
  const failedRelays = allResults
    .filter((r) => !r.ok)
    .map((r) => ({ relay: r.relay, reason: (r as any).reason ?? "failed" }));

  return {
    ok: okRelays.length > 0,
    okRelays,
    failedRelays
  };
}
