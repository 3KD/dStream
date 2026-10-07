import type { Event as NostrToolsEvent } from "nostr-tools/core";
import { bytesToHex } from "@/lib/encoding";
import { loadNostrWasm } from "@/lib/nostrWasm";

export interface Nip04Cipher {
  encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>;
  decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>;
}

export interface SignalIdentity {
  pubkey: string;
  signEvent: (unsigned: Omit<NostrToolsEvent, "id" | "sig">) => Promise<NostrToolsEvent>;
  nip04: Nip04Cipher;
}

export async function createLocalSignalIdentity(): Promise<SignalIdentity> {
  const runtime = await loadNostrWasm();
  const secretKey = runtime.generateSecretKey();
  const pubkey = bytesToHex(runtime.getPublicKey(secretKey)).toLowerCase();

  return {
    pubkey,
    signEvent: async (unsigned) => {
      const eventWithoutPubkey: Record<string, unknown> = {
        kind: unsigned.kind,
        created_at: unsigned.created_at,
        tags: unsigned.tags,
        content: unsigned.content
      };
      runtime.finalizeEvent(eventWithoutPubkey, secretKey);
      return eventWithoutPubkey as NostrToolsEvent;
    },
    nip04: {
      encrypt: async (recipientPubkey, plaintext) => {
        const { encrypt } = await import("nostr-tools/nip04");
        return encrypt(secretKey, recipientPubkey, plaintext);
      },
      decrypt: async (senderPubkey, ciphertext) => {
        const { decrypt } = await import("nostr-tools/nip04");
        return decrypt(secretKey, senderPubkey, ciphertext);
      }
    }
  };
}
