"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createDefaultSocialState,
  makeStreamFavoriteKey,
  normalizePubkey,
  parseSocialState,
  type P2PPeerMode,
  type SocialSettingsV1,
  type SocialStateV1
} from "@/lib/social/store";

interface SocialContextValue {
  state: SocialStateV1;
  isLoading: boolean;
  settings: SocialSettingsV1;

  getAlias: (pubkeyHex: string) => string | null;

  setAlias: (pubkeyInput: string, alias: string) => { ok: true; pubkey: string } | { ok: false; error: string };
  removeAlias: (pubkeyHex: string) => void;

  isTrusted: (pubkeyHex: string) => boolean;
  isMuted: (pubkeyHex: string) => boolean;
  isBlocked: (pubkeyHex: string) => boolean;

  addTrusted: (pubkeyInput: string) => { ok: true; pubkey: string } | { ok: false; error: string };
  removeTrusted: (pubkeyHex: string) => void;

  addMuted: (pubkeyInput: string) => { ok: true; pubkey: string } | { ok: false; error: string };
  removeMuted: (pubkeyHex: string) => void;

  addBlocked: (pubkeyInput: string) => { ok: true; pubkey: string } | { ok: false; error: string };
  removeBlocked: (pubkeyHex: string) => void;

  isFavoriteCreator: (pubkeyHex: string) => boolean;
  toggleFavoriteCreator: (pubkeyHex: string) => void;

  isFavoriteStream: (streamPubkeyHex: string, streamId: string) => boolean;
  toggleFavoriteStream: (streamPubkeyHex: string, streamId: string) => void;

  updateSettings: (patch: Partial<SocialSettingsV1>) => void;
  setP2PPeerMode: (mode: P2PPeerMode) => void;

  resetAll: () => void;
}

const SocialContext = createContext<SocialContextValue | null>(null);
const STORAGE_KEY = "dstream_social_v1";

function readLegacyToggle(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function SocialProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SocialStateV1>(() => createDefaultSocialState());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const existing = parseSocialState(localStorage.getItem(STORAGE_KEY));
      if (existing) {
        setState(existing);
        return;
      }

      const migrated = createDefaultSocialState();
      const legacyPresence = readLegacyToggle("dstream_presence_enabled_v1");
      if (legacyPresence !== null) migrated.settings.presenceEnabled = legacyPresence;
      const legacyP2P = readLegacyToggle("dstream_p2p_enabled_v1");
      if (legacyP2P !== null) migrated.settings.p2pAssistEnabled = legacyP2P;

      setState(migrated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch {
      setState(createDefaultSocialState());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [isLoading, state]);

  const sets = useMemo(() => {
    return {
      trusted: new Set(state.trustedPubkeys),
      muted: new Set(state.mutedPubkeys),
      blocked: new Set(state.blockedPubkeys),
      favCreators: new Set(state.favorites.creators),
      favStreams: new Set(state.favorites.streams)
    };
  }, [state.blockedPubkeys, state.favorites.creators, state.favorites.streams, state.mutedPubkeys, state.trustedPubkeys]);

  const mutate = useCallback((fn: (prev: SocialStateV1) => SocialStateV1) => {
    setState((prev) => fn(prev));
  }, []);

  const getAlias = useCallback(
    (pubkeyHex: string) => {
      const pk = normalizePubkey(pubkeyHex);
      if (!pk) return null;
      return state.aliases[pk] ?? null;
    },
    [state.aliases]
  );

  const setAlias = useCallback(
    (pubkeyInput: string, aliasRaw: string) => {
      const pk = normalizePubkey(pubkeyInput);
      if (!pk) return { ok: false as const, error: "Invalid pubkey (expected npub… or 64-hex)." };
      const alias = (aliasRaw ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      if (!alias) return { ok: false as const, error: "Alias is required." };
      mutate((prev) => ({ ...prev, aliases: { ...prev.aliases, [pk]: alias } }));
      return { ok: true as const, pubkey: pk };
    },
    [mutate]
  );

  const removeAlias = useCallback(
    (pubkeyHex: string) => {
      const pk = normalizePubkey(pubkeyHex);
      if (!pk) return;
      mutate((prev) => {
        const next = { ...prev.aliases };
        delete next[pk];
        return { ...prev, aliases: next };
      });
    },
    [mutate]
  );

  const isTrusted = useCallback((pubkeyHex: string) => sets.trusted.has(pubkeyHex), [sets.trusted]);
  const isMuted = useCallback((pubkeyHex: string) => sets.muted.has(pubkeyHex), [sets.muted]);
  const isBlocked = useCallback((pubkeyHex: string) => sets.blocked.has(pubkeyHex), [sets.blocked]);

  const addToList = useCallback(
    (list: "trustedPubkeys" | "mutedPubkeys" | "blockedPubkeys", pubkeyInput: string) => {
      const pk = normalizePubkey(pubkeyInput);
      if (!pk) return { ok: false as const, error: "Invalid pubkey (expected npub… or 64-hex)." };
      mutate((prev) => {
        const nextList = Array.from(new Set([...(prev[list] ?? []), pk])).sort((a, b) => a.localeCompare(b));
        return { ...prev, [list]: nextList } as SocialStateV1;
      });
      return { ok: true as const, pubkey: pk };
    },
    [mutate]
  );

  const removeFromList = useCallback(
    (list: "trustedPubkeys" | "mutedPubkeys" | "blockedPubkeys", pubkeyHex: string) => {
      const pk = normalizePubkey(pubkeyHex);
      if (!pk) return;
      mutate((prev) => {
        const nextList = (prev[list] ?? []).filter((v) => v !== pk);
        return { ...prev, [list]: nextList } as SocialStateV1;
      });
    },
    [mutate]
  );

  const addTrusted = useCallback((pubkeyInput: string) => addToList("trustedPubkeys", pubkeyInput), [addToList]);
  const removeTrusted = useCallback((pubkeyHex: string) => removeFromList("trustedPubkeys", pubkeyHex), [removeFromList]);

  const addMuted = useCallback((pubkeyInput: string) => addToList("mutedPubkeys", pubkeyInput), [addToList]);
  const removeMuted = useCallback((pubkeyHex: string) => removeFromList("mutedPubkeys", pubkeyHex), [removeFromList]);

  const addBlocked = useCallback((pubkeyInput: string) => addToList("blockedPubkeys", pubkeyInput), [addToList]);
  const removeBlocked = useCallback((pubkeyHex: string) => removeFromList("blockedPubkeys", pubkeyHex), [removeFromList]);

  const isFavoriteCreator = useCallback((pubkeyHex: string) => sets.favCreators.has(pubkeyHex), [sets.favCreators]);
  const toggleFavoriteCreator = useCallback(
    (pubkeyHex: string) => {
      const pk = normalizePubkey(pubkeyHex);
      if (!pk) return;
      mutate((prev) => {
        const set = new Set(prev.favorites.creators);
        if (set.has(pk)) set.delete(pk);
        else set.add(pk);
        const creators = Array.from(set).sort((a, b) => a.localeCompare(b));
        return { ...prev, favorites: { ...prev.favorites, creators } };
      });
    },
    [mutate]
  );

  const isFavoriteStream = useCallback(
    (streamPubkeyHex: string, streamId: string) => {
      const key = makeStreamFavoriteKey(streamPubkeyHex, streamId);
      if (!key) return false;
      return sets.favStreams.has(key);
    },
    [sets.favStreams]
  );

  const toggleFavoriteStream = useCallback(
    (streamPubkeyHex: string, streamId: string) => {
      const key = makeStreamFavoriteKey(streamPubkeyHex, streamId);
      if (!key) return;
      mutate((prev) => {
        const set = new Set(prev.favorites.streams);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        const streams = Array.from(set).sort((a, b) => a.localeCompare(b));
        return { ...prev, favorites: { ...prev.favorites, streams } };
      });
    },
    [mutate]
  );

  const updateSettings = useCallback(
    (patch: Partial<SocialSettingsV1>) => {
      mutate((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    },
    [mutate]
  );

  const setP2PPeerMode = useCallback(
    (mode: P2PPeerMode) => {
      updateSettings({ p2pPeerMode: mode });
    },
    [updateSettings]
  );

  const resetAll = useCallback(() => {
    const next = createDefaultSocialState();
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<SocialContextValue>(
    () => ({
      state,
      isLoading,
      settings: state.settings,
      getAlias,
      setAlias,
      removeAlias,
      isTrusted,
      isMuted,
      isBlocked,
      addTrusted,
      removeTrusted,
      addMuted,
      removeMuted,
      addBlocked,
      removeBlocked,
      isFavoriteCreator,
      toggleFavoriteCreator,
      isFavoriteStream,
      toggleFavoriteStream,
      updateSettings,
      setP2PPeerMode,
      resetAll
    }),
    [
      addBlocked,
      addMuted,
      addTrusted,
      getAlias,
      isBlocked,
      isFavoriteCreator,
      isFavoriteStream,
      isLoading,
      isMuted,
      isTrusted,
      removeAlias,
      removeBlocked,
      removeMuted,
      removeTrusted,
      resetAll,
      setAlias,
      setP2PPeerMode,
      state,
      toggleFavoriteCreator,
      toggleFavoriteStream,
      updateSettings
    ]
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error("useSocial must be used within SocialProvider");
  return ctx;
}

