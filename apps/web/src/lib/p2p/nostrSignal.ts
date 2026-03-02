import {
  buildP2PSignalEvent,
  decodeP2PSignalPayload,
  encodeP2PSignalPayload,
  makeATag,
  NOSTR_KINDS,
  parseP2PSignalEvent,
  type P2PSignalPayloadV1
} from "@dstream/protocol";
import { SimplePool } from "nostr-tools";
import { getPool } from "@/lib/nostr";
import type { SignalIdentity } from "./localIdentity";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export interface P2PSignalMessage {
  fromPubkey: string;
  payload: P2PSignalPayloadV1;
  eventId?: string;
}

export interface P2PSignalClient {
  readonly identity: SignalIdentity;
  readonly relays: string[];
  readonly streamPubkey: string;
  readonly streamId: string;
  send: (recipientPubkey: string, payload: P2PSignalPayloadV1) => Promise<{ ok: boolean }>;
  subscribe: (handler: (msg: P2PSignalMessage) => void) => { close: () => void; ready: Promise<void> };
}

export function createP2PSignalClient(opts: {
  identity: SignalIdentity;
  relays: string[];
  streamPubkey: string;
  streamId: string;
  sinceSec?: number;
  label?: string;
  onLog?: (line: string) => void;
  pool?: SimplePool;
}): P2PSignalClient {
  const { identity, relays, streamPubkey, streamId } = opts;
  const aTag = makeATag(streamPubkey, streamId);
  const since = opts.sinceSec ?? Math.max(0, nowSec() - 5);
  const log = (line: string) => opts.onLog?.(`${opts.label ? `${opts.label}: ` : ""}${line}`);
  const pool = opts.pool ?? getPool();

  log(`init kind=${NOSTR_KINDS.P2P_SIGNAL} since=${since}`);

  return {
    identity,
    relays,
    streamPubkey,
    streamId,
    send: async (recipientPubkey, payload) => {
      const plaintext = encodeP2PSignalPayload(payload);
      const ciphertext = await identity.nip04.encrypt(recipientPubkey, plaintext);

      const unsigned: any = buildP2PSignalEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        recipientPubkey,
        streamPubkey,
        streamId,
        content: ciphertext,
        expiresAt: nowSec() + 90
      });

      const signed = await identity.signEvent(unsigned);
      const timeoutMs = 4000;
      const pubs = pool.publish(relays, signed) as any[];
      try {
        await Promise.race([
          Promise.any(pubs as any),
          new Promise((_, reject) => setTimeout(() => reject(new Error("publish timeout")), timeoutMs))
        ]);
        return { ok: true };
      } catch (e: any) {
        log(`send ${payload.type}: failed (${e?.message ?? String(e)})`);
        return { ok: false };
      }
    },

    subscribe: (handler) => {
      let readyResolve: (() => void) | null = null;
      const ready = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });

      const sub: any = (pool as any).subscribeMany(
        relays,
        {
          kinds: [NOSTR_KINDS.P2P_SIGNAL],
          since,
          "#p": [identity.pubkey],
          "#a": [aTag],
          limit: 200
        },
        {
          onevent: async (event: any) => {
            const raw = event as any;
            if (raw?.pubkey && raw?.id) log(`recv event from=${String(raw.pubkey).slice(0, 8)}… id=${String(raw.id).slice(0, 8)}…`);

            const parsed = parseP2PSignalEvent(event as any, {
              streamPubkey,
              streamId,
              recipientPubkey: identity.pubkey
            });
            if (!parsed) {
              log("drop: parse failed");
              return;
            }

            try {
              const decrypted = await identity.nip04.decrypt(parsed.pubkey, parsed.content);
              const payload = decodeP2PSignalPayload(decrypted);
              if (!payload) {
                log("drop: payload decode failed");
                return;
              }
              handler({ fromPubkey: parsed.pubkey, payload, eventId: parsed.id });
            } catch {
              log("drop: decrypt failed");
            }
          },
          oneose: () => readyResolve?.()
        }
      );

      return { close: () => sub?.close?.(), ready };
    }
  };
}
