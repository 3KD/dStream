import { finalizeEvent, generateSecretKey, getPublicKey, nip04, type Event as NostrToolsEvent } from "nostr-tools";

export interface Nip04Cipher {
  encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>;
  decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>;
}

export interface SignalIdentity {
  pubkey: string;
  signEvent: (unsigned: Omit<NostrToolsEvent, "id" | "sig">) => Promise<NostrToolsEvent>;
  nip04: Nip04Cipher;
}

export function createLocalSignalIdentity(): SignalIdentity {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);

  return {
    pubkey,
    signEvent: async (unsigned) => {
      const eventWithoutPubkey: any = {
        kind: unsigned.kind,
        created_at: unsigned.created_at,
        tags: unsigned.tags,
        content: unsigned.content
      };
      return finalizeEvent(eventWithoutPubkey, secretKey);
    },
    nip04: {
      encrypt: async (recipientPubkey, plaintext) => nip04.encrypt(secretKey, recipientPubkey, plaintext),
      decrypt: async (senderPubkey, ciphertext) => nip04.decrypt(secretKey, senderPubkey, ciphertext)
    }
  };
}

