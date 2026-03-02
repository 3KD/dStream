"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { finalizeEvent, generateSecretKey, getPublicKey, nip04, nip19, type Event as NostrToolsEvent } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@/lib/encoding";

export type Identity =
  | { kind: "extension"; pubkey: string }
  | { kind: "local"; pubkey: string; secretKeyHex: string; label?: string | null };

type UnsignedNostrEvent = Omit<NostrToolsEvent, "id" | "sig">;

export interface Nip04Cipher {
  encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>;
  decrypt: (senderPubkey: string, ciphertext: string) => Promise<string>;
}

interface LocalIdentityEntry {
  pubkey: string;
  secretKeyHex: string;
  label?: string;
  createdAt: number;
}

interface IdentityStoreV2 {
  version: 2;
  active: { kind: "extension"; pubkey: string } | { kind: "local"; pubkey: string } | null;
  locals: Record<string, LocalIdentityEntry>;
}

interface IdentityContextValue {
  identity: Identity | null;
  isLoading: boolean;
  localIdentities: Array<{ pubkey: string; label: string | null; createdAt: number; isActive: boolean }>;
  connectExtension: () => Promise<void>;
  generateLocal: () => Promise<void>;
  importLocalSecret: (input: string, label?: string) => { ok: true; pubkey: string } | { ok: false; error: string };
  exportLocalSecret: () => string | null;
  switchLocalIdentity: (pubkey: string) => boolean;
  removeLocalIdentity: (pubkey: string) => boolean;
  setLocalIdentityLabel: (pubkey: string, label: string) => boolean;
  logout: () => void;
  signEvent: (unsigned: UnsignedNostrEvent) => Promise<NostrToolsEvent>;
  nip04: Nip04Cipher | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);
const STORAGE_KEY_V1 = "dstream_identity_v1";
const STORAGE_KEY_V2 = "dstream_identity_store_v2";

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

function normalizeLabel(raw: string | null | undefined): string | undefined {
  const label = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
  return label || undefined;
}

function toStoreV2(input: unknown): IdentityStoreV2 | null {
  if (!input || typeof input !== "object") return null;
  if ((input as any).version !== 2) return null;
  const activeRaw = (input as any).active;
  const localsRaw = (input as any).locals;
  if (!localsRaw || typeof localsRaw !== "object") return null;

  const locals: Record<string, LocalIdentityEntry> = {};
  for (const [pubkeyRaw, value] of Object.entries(localsRaw as any)) {
    const pubkey = (pubkeyRaw ?? "").trim().toLowerCase();
    if (!isHex64(pubkey)) continue;
    if (!value || typeof value !== "object") continue;
    const secretKeyHex = typeof (value as any).secretKeyHex === "string" ? (value as any).secretKeyHex.trim().toLowerCase() : "";
    if (!isHex64(secretKeyHex)) continue;
    const derivedPubkey = getPublicKey(hexToBytes(secretKeyHex));
    if (derivedPubkey !== pubkey) continue;
    const createdAt =
      typeof (value as any).createdAt === "number" && Number.isFinite((value as any).createdAt) ? Math.floor((value as any).createdAt) : Date.now();
    locals[pubkey] = {
      pubkey,
      secretKeyHex,
      label: normalizeLabel((value as any).label),
      createdAt
    };
  }

  let active: IdentityStoreV2["active"] = null;
  if (activeRaw && typeof activeRaw === "object") {
    const kind = (activeRaw as any).kind;
    const pubkey = typeof (activeRaw as any).pubkey === "string" ? (activeRaw as any).pubkey.trim().toLowerCase() : "";
    if ((kind === "extension" || kind === "local") && isHex64(pubkey)) {
      if (kind === "local" && !locals[pubkey]) {
        active = null;
      } else {
        active = { kind, pubkey } as IdentityStoreV2["active"];
      }
    }
  }

  return {
    version: 2,
    active,
    locals
  };
}

function migrateFromV1(raw: string | null): IdentityStoreV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if ((parsed as any).kind === "extension") {
      const pubkey = typeof (parsed as any).pubkey === "string" ? (parsed as any).pubkey.trim().toLowerCase() : "";
      if (!isHex64(pubkey)) return null;
      return {
        version: 2,
        active: { kind: "extension", pubkey },
        locals: {}
      };
    }

    if ((parsed as any).kind === "local") {
      const secretKeyHex = typeof (parsed as any).secretKeyHex === "string" ? (parsed as any).secretKeyHex.trim().toLowerCase() : "";
      if (!isHex64(secretKeyHex)) return null;
      const pubkey = getPublicKey(hexToBytes(secretKeyHex));
      return {
        version: 2,
        active: { kind: "local", pubkey },
        locals: {
          [pubkey]: {
            pubkey,
            secretKeyHex,
            createdAt: Date.now()
          }
        }
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseSecretInput(inputRaw: string): string | null {
  const input = (inputRaw ?? "").trim();
  if (!input) return null;
  if (isHex64(input)) return input.toLowerCase();

  if (input.startsWith("nsec")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type !== "nsec") return null;
      const data = decoded.data;
      if (!(data instanceof Uint8Array)) return null;
      const secret = bytesToHex(data).toLowerCase();
      return isHex64(secret) ? secret : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<IdentityStoreV2>({
    version: 2,
    active: null,
    locals: {}
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const v2 = localStorage.getItem(STORAGE_KEY_V2);
      const parsedV2 = v2 ? toStoreV2(JSON.parse(v2)) : null;
      if (parsedV2) {
        setStore(parsedV2);
      } else {
        const migrated = migrateFromV1(localStorage.getItem(STORAGE_KEY_V1));
        if (migrated) setStore(migrated);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(store));
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch {
      // ignore
    }
  }, [isLoading, store]);

  const identity = useMemo<Identity | null>(() => {
    if (!store.active) return null;
    if (store.active.kind === "extension") return { kind: "extension", pubkey: store.active.pubkey };
    const entry = store.locals[store.active.pubkey];
    if (!entry) return null;
    return {
      kind: "local",
      pubkey: entry.pubkey,
      secretKeyHex: entry.secretKeyHex,
      label: entry.label ?? null
    };
  }, [store.active, store.locals]);

  const localIdentities = useMemo(() => {
    const activeLocalPubkey = store.active?.kind === "local" ? store.active.pubkey : null;
    return Object.values(store.locals)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => ({
        pubkey: entry.pubkey,
        label: entry.label ?? null,
        createdAt: entry.createdAt,
        isActive: activeLocalPubkey === entry.pubkey
      }));
  }, [store.active, store.locals]);

  const connectExtension = useCallback(async () => {
    const nostr = (window as any)?.nostr;
    if (!nostr?.getPublicKey || !nostr?.signEvent) {
      throw new Error("No NIP-07 extension found (window.nostr).");
    }
    const pubkey = (await nostr.getPublicKey()).trim().toLowerCase();
    if (!isHex64(pubkey)) throw new Error("NIP-07 extension returned an invalid pubkey.");
    setStore((prev) => ({ ...prev, active: { kind: "extension", pubkey } }));
  }, []);

  const generateLocal = useCallback(async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const secretKeyHex = bytesToHex(sk).toLowerCase();
    setStore((prev) => ({
      ...prev,
      active: { kind: "local", pubkey },
      locals: {
        ...prev.locals,
        [pubkey]: {
          pubkey,
          secretKeyHex,
          createdAt: Date.now()
        }
      }
    }));
  }, []);

  const importLocalSecret = useCallback((input: string, label?: string) => {
    const secretKeyHex = parseSecretInput(input);
    if (!secretKeyHex) return { ok: false as const, error: "Invalid secret key. Expected nsec… or 64-hex." };
    const pubkey = getPublicKey(hexToBytes(secretKeyHex));
    const normalizedLabel = normalizeLabel(label);
    setStore((prev) => ({
      ...prev,
      active: { kind: "local", pubkey },
      locals: {
        ...prev.locals,
        [pubkey]: {
          pubkey,
          secretKeyHex,
          label: normalizedLabel,
          createdAt: prev.locals[pubkey]?.createdAt ?? Date.now()
        }
      }
    }));
    return { ok: true as const, pubkey };
  }, []);

  const exportLocalSecret = useCallback(() => {
    if (store.active?.kind !== "local") return null;
    return store.locals[store.active.pubkey]?.secretKeyHex ?? null;
  }, [store.active, store.locals]);

  const switchLocalIdentity = useCallback((pubkeyInput: string) => {
    const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
    if (!isHex64(pubkey)) return false;
    if (!store.locals[pubkey]) return false;
    setStore((prev) => ({ ...prev, active: { kind: "local", pubkey } }));
    return true;
  }, [store.locals]);

  const removeLocalIdentity = useCallback(
    (pubkeyInput: string) => {
      const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
      if (!isHex64(pubkey)) return false;
      if (!store.locals[pubkey]) return false;

      setStore((prev) => {
        const nextLocals = { ...prev.locals };
        delete nextLocals[pubkey];

        let nextActive = prev.active;
        if (prev.active?.kind === "local" && prev.active.pubkey === pubkey) {
          const fallback = Object.keys(nextLocals)[0];
          nextActive = fallback ? { kind: "local", pubkey: fallback } : null;
        }

        return { ...prev, locals: nextLocals, active: nextActive };
      });
      return true;
    },
    [store.locals]
  );

  const setLocalIdentityLabel = useCallback(
    (pubkeyInput: string, labelRaw: string) => {
      const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
      if (!isHex64(pubkey)) return false;
      if (!store.locals[pubkey]) return false;
      setStore((prev) => ({
        ...prev,
        locals: {
          ...prev.locals,
          [pubkey]: {
            ...prev.locals[pubkey],
            label: normalizeLabel(labelRaw)
          }
        }
      }));
      return true;
    },
    [store.locals]
  );

  const logout = useCallback(() => {
    setStore((prev) => ({ ...prev, active: null }));
  }, []);

  const signEvent = useCallback(
    async (unsigned: UnsignedNostrEvent): Promise<NostrToolsEvent> => {
      if (!identity) throw new Error("No identity connected.");

      if (identity.kind === "extension") {
        const nostr = (window as any)?.nostr;
        if (!nostr?.signEvent) throw new Error("NIP-07 signEvent unavailable.");
        return await nostr.signEvent(unsigned);
      }

      const sk = hexToBytes(identity.secretKeyHex);
      const eventWithoutPubkey: any = {
        kind: unsigned.kind,
        created_at: unsigned.created_at,
        tags: unsigned.tags,
        content: unsigned.content
      };
      return finalizeEvent(eventWithoutPubkey, sk);
    },
    [identity]
  );

  const nip04Cipher = useMemo<Nip04Cipher | null>(() => {
    if (!identity) return null;

    if (identity.kind === "extension") {
      const nostr = (window as any)?.nostr;
      const impl = nostr?.nip04;
      if (!impl?.encrypt || !impl?.decrypt) return null;
      return {
        encrypt: async (recipientPubkey, plaintext) => await impl.encrypt(recipientPubkey, plaintext),
        decrypt: async (senderPubkey, ciphertext) => await impl.decrypt(senderPubkey, ciphertext)
      };
    }

    const sk = hexToBytes(identity.secretKeyHex);
    return {
      encrypt: async (recipientPubkey, plaintext) => await nip04.encrypt(sk, recipientPubkey, plaintext),
      decrypt: async (senderPubkey, ciphertext) => await nip04.decrypt(sk, senderPubkey, ciphertext)
    };
  }, [identity]);

  const value = useMemo<IdentityContextValue>(
    () => ({
      identity,
      isLoading,
      localIdentities,
      connectExtension,
      generateLocal,
      importLocalSecret,
      exportLocalSecret,
      switchLocalIdentity,
      removeLocalIdentity,
      setLocalIdentityLabel,
      logout,
      signEvent,
      nip04: nip04Cipher
    }),
    [
      identity,
      isLoading,
      localIdentities,
      connectExtension,
      generateLocal,
      importLocalSecret,
      exportLocalSecret,
      switchLocalIdentity,
      removeLocalIdentity,
      setLocalIdentityLabel,
      logout,
      signEvent,
      nip04Cipher
    ]
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used within IdentityProvider");
  return ctx;
}
