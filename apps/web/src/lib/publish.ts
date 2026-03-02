import type { Event as NostrEvent } from "nostr-tools";
import { getPool } from "@/lib/nostr";

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

export async function publishEvent(relays: string[], event: NostrEvent): Promise<boolean> {
  if (relays.length === 0) throw new Error("No relays configured");

  const pubs = getPool().publish(relays, event);
  try {
    await Promise.race([
      Promise.any(pubs as any),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Publish timeout")), 15000))
    ]);
    return true;
  } catch {
    for (const relay of relays) {
      // Fallback path for local relay conditions where pool ACK promises can stall.
      // If at least one relay explicitly returns OK, treat publish as successful.
      if (await publishViaRelayWebSocket(relay, event, 4000)) return true;
    }
    return false;
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
  const timeoutMs = opts?.timeoutMs ?? 8000;

  const pubs = getPool().publish(relays, event) as any[];

  const initialResults = await Promise.all(
    relays.map(async (relay, i) => {
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

  const okRelaysSet = new Set(initialResults.filter((result) => result.ok).map((result) => result.relay));

  const failedWithFallback = await Promise.all(
    initialResults
      .filter((result) => !result.ok)
      .map(async (result) => {
        const fallbackOk = await publishViaRelayWebSocket(result.relay, event, Math.min(timeoutMs, 5000));
        return {
          relay: result.relay,
          fallbackOk,
          reason: (result as any).reason ?? "failed"
        };
      })
  );

  for (const result of failedWithFallback) {
    if (result.fallbackOk) okRelaysSet.add(result.relay);
  }

  const okRelays = Array.from(okRelaysSet);
  const failedRelays = failedWithFallback
    .filter((result) => !result.fallbackOk)
    .map((result) => ({ relay: result.relay, reason: result.reason }));

  return {
    ok: okRelays.length > 0,
    okRelays,
    failedRelays
  };
}
