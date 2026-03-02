"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildStreamAnnounceEvent, makeStreamKey, type StreamAnnounce, type StreamVodPolicy } from "@dstream/protocol";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useStreamAnnounces } from "@/hooks/useStreamAnnounces";
import { getNostrRelays } from "@/lib/config";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { publishEventDetailed } from "@/lib/publish";
import { shortenText } from "@/lib/encoding";
import { formatXmrAtomic, resolveVodPolicy, vodModeLabel } from "@/lib/vodPolicy";

type VodModeFilter = "all" | "public" | "paid";
type ScopePatchMode = "keep" | "stream" | "playlist";
type VodModePatch = "keep" | "public" | "paid";
type PricePatchMode = "keep" | "set";
type AccessWindowPatchMode = "keep" | "set" | "clear";
type CreatorListSortMode = "newest" | "oldest" | "title_asc" | "title_desc" | "playlist_asc" | "playlist_desc";
type PlaylistSortMode = "latest" | "name_asc" | "name_desc" | "size_desc" | "size_asc";

interface PlaylistActionResult {
  success: number;
  failures: string[];
}

interface LocalVodEntitlement {
  key: string;
  kind: "stream" | "playlist";
  pubkey: string;
  targetId: string;
  accessScope: "stream" | "playlist";
  playlistId: string | null;
  expMs: number;
  expired: boolean;
}

interface VodPatchPresetValues {
  playlistTargetInput: string;
  playlistScopePatch: ScopePatchMode;
  vodModePatch: VodModePatch;
  pricePatchMode: PricePatchMode;
  priceXmrPatchInput: string;
  accessPatchMode: AccessWindowPatchMode;
  accessHoursPatchInput: string;
}

interface VodPatchPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  values: VodPatchPresetValues;
}

const STREAM_ENTITLEMENT_PREFIX = "dstream_vod_access_v1:";
const PLAYLIST_ENTITLEMENT_PREFIX = "dstream_vod_playlist_access_v1:";
const VOD_PATCH_PRESETS_STORAGE_KEY = "dstream_vod_patch_presets_v1";

function parseXmrAmountToAtomic(inputRaw: string): bigint | null {
  const input = inputRaw.trim();
  if (!input) return null;
  if (!/^\d+(\.\d{1,12})?$/.test(input)) return null;
  const [wholePart, fracPart = ""] = input.split(".");
  try {
    const whole = BigInt(wholePart);
    const frac = BigInt((fracPart + "0".repeat(12)).slice(0, 12));
    const atomic = whole * 1_000_000_000_000n + frac;
    return atomic > 0n ? atomic : null;
  } catch {
    return null;
  }
}

function parsePositiveInt(inputRaw: string): number | null {
  const value = inputRaw.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function readVodPatchPresetsFromStorage(): VodPatchPreset[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(VOD_PATCH_PRESETS_STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const presets: VodPatchPreset[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const id = typeof (item as any).id === "string" ? (item as any).id.trim() : "";
    const name = typeof (item as any).name === "string" ? (item as any).name.trim() : "";
    const createdAt = typeof (item as any).createdAt === "number" ? (item as any).createdAt : Date.now();
    const updatedAt = typeof (item as any).updatedAt === "number" ? (item as any).updatedAt : createdAt;
    const values = (item as any).values;
    if (!id || !name || !values || typeof values !== "object") continue;

    const playlistScopePatch: ScopePatchMode =
      values.playlistScopePatch === "stream" || values.playlistScopePatch === "playlist" ? values.playlistScopePatch : "keep";
    const vodModePatch: VodModePatch =
      values.vodModePatch === "public" || values.vodModePatch === "paid" ? values.vodModePatch : "keep";
    const pricePatchMode: PricePatchMode = values.pricePatchMode === "set" ? "set" : "keep";
    const accessPatchMode: AccessWindowPatchMode =
      values.accessPatchMode === "set" || values.accessPatchMode === "clear" ? values.accessPatchMode : "keep";

    presets.push({
      id,
      name,
      createdAt,
      updatedAt,
      values: {
        playlistTargetInput: typeof values.playlistTargetInput === "string" ? values.playlistTargetInput : "",
        playlistScopePatch,
        vodModePatch,
        pricePatchMode,
        priceXmrPatchInput: typeof values.priceXmrPatchInput === "string" ? values.priceXmrPatchInput : "",
        accessPatchMode,
        accessHoursPatchInput: typeof values.accessHoursPatchInput === "string" ? values.accessHoursPatchInput : ""
      }
    });
  }

  return presets.sort((a, b) => b.updatedAt - a.updatedAt);
}

function writeVodPatchPresetsToStorage(presets: VodPatchPreset[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VOD_PATCH_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function readVodEntitlementsFromStorage(nowMs = Date.now()): LocalVodEntitlement[] {
  if (typeof window === "undefined") return [];

  const entries: LocalVodEntitlement[] = [];
  for (let idx = 0; idx < localStorage.length; idx += 1) {
    const key = localStorage.key(idx);
    if (!key) continue;

    let kind: "stream" | "playlist" | null = null;
    let rest = "";
    if (key.startsWith(STREAM_ENTITLEMENT_PREFIX)) {
      kind = "stream";
      rest = key.slice(STREAM_ENTITLEMENT_PREFIX.length);
    } else if (key.startsWith(PLAYLIST_ENTITLEMENT_PREFIX)) {
      kind = "playlist";
      rest = key.slice(PLAYLIST_ENTITLEMENT_PREFIX.length);
    }
    if (!kind) continue;

    const splitIndex = rest.indexOf(":");
    if (splitIndex <= 0 || splitIndex >= rest.length - 1) continue;
    const pubkey = rest.slice(0, splitIndex).trim().toLowerCase();
    const targetId = rest.slice(splitIndex + 1).trim();
    if (!pubkey || !targetId) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const expMs = typeof parsed?.expMs === "number" && Number.isFinite(parsed.expMs) ? Math.floor(parsed.expMs) : 0;
    if (!expMs) continue;

    const accessScope = parsed?.accessScope === "playlist" ? "playlist" : "stream";
    const playlistId = typeof parsed?.playlistId === "string" && parsed.playlistId.trim() ? parsed.playlistId.trim() : null;

    entries.push({
      key,
      kind,
      pubkey,
      targetId,
      accessScope,
      playlistId,
      expMs,
      expired: expMs <= nowMs
    });
  }

  return entries.sort((a, b) => a.expMs - b.expMs);
}

function buildUpdatedVodPolicy(
  stream: StreamAnnounce,
  targetPlaylistId: string,
  scopePatch: ScopePatchMode,
  modePatch: VodModePatch,
  pricePatchMode: PricePatchMode,
  priceAtomicPatch: string | null,
  accessPatchMode: AccessWindowPatchMode,
  accessSecondsPatch: number | null
): StreamVodPolicy {
  const current = resolveVodPolicy(stream);
  const normalizedPlaylistId = targetPlaylistId.trim();
  const mode = modePatch === "keep" ? current.mode : modePatch;

  const updated: StreamVodPolicy = { mode };
  if (normalizedPlaylistId) updated.playlistId = normalizedPlaylistId;

  if (mode === "paid") {
    const nextPriceAtomic =
      pricePatchMode === "set" ? priceAtomicPatch ?? undefined : current.mode === "paid" ? current.priceAtomic : undefined;
    if (nextPriceAtomic) updated.priceAtomic = nextPriceAtomic;
    updated.currency = "xmr";

    if (accessPatchMode === "set") {
      if (accessSecondsPatch) updated.accessSeconds = accessSecondsPatch;
    } else if (accessPatchMode === "keep" && current.accessSeconds) {
      updated.accessSeconds = current.accessSeconds;
    }

    const inferredScope: "stream" | "playlist" =
      current.accessScope === "playlist" && !!(current.playlistId || normalizedPlaylistId) ? "playlist" : "stream";
    const requestedScope = scopePatch === "keep" ? inferredScope : scopePatch;
    updated.accessScope = requestedScope === "playlist" && !!updated.playlistId ? "playlist" : "stream";
  }

  return updated;
}

export default function VodPage() {
  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);
  const { streams, isLoading } = useStreamAnnounces({ liveOnly: false, limit: 420 });
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<VodModeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [creatorParam, setCreatorParam] = useState("");
  const [vodOverrides, setVodOverrides] = useState<Record<string, StreamVodPolicy>>({});
  const [playlistTargetInput, setPlaylistTargetInput] = useState("");
  const [playlistScopePatch, setPlaylistScopePatch] = useState<ScopePatchMode>("keep");
  const [vodModePatch, setVodModePatch] = useState<VodModePatch>("keep");
  const [pricePatchMode, setPricePatchMode] = useState<PricePatchMode>("keep");
  const [priceXmrPatchInput, setPriceXmrPatchInput] = useState("");
  const [accessPatchMode, setAccessPatchMode] = useState<AccessWindowPatchMode>("keep");
  const [accessHoursPatchInput, setAccessHoursPatchInput] = useState("");
  const [creatorListSortMode, setCreatorListSortMode] = useState<CreatorListSortMode>("newest");
  const [playlistSortMode, setPlaylistSortMode] = useState<PlaylistSortMode>("latest");
  const [selectedStreamKeys, setSelectedStreamKeys] = useState<Record<string, boolean>>({});
  const [playlistActionBusy, setPlaylistActionBusy] = useState(false);
  const [playlistActionError, setPlaylistActionError] = useState<string | null>(null);
  const [playlistActionResult, setPlaylistActionResult] = useState<PlaylistActionResult | null>(null);
  const [entitlements, setEntitlements] = useState<LocalVodEntitlement[]>([]);
  const [showExpiredEntitlements, setShowExpiredEntitlements] = useState(false);
  const [mineOnlyEntitlements, setMineOnlyEntitlements] = useState(true);
  const [savedPresets, setSavedPresets] = useState<VodPatchPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetNameInput, setPresetNameInput] = useState("");
  const [presetStatus, setPresetStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setCreatorParam(params.get("creator") ?? "");
    } catch {
      setCreatorParam("");
    }
  }, []);
  const creatorFilter = useMemo(() => {
    return pubkeyParamToHex(creatorParam);
  }, [creatorParam]);
  const creatorFilterNpub = useMemo(() => (creatorFilter ? pubkeyHexToNpub(creatorFilter) : null), [creatorFilter]);

  useEffect(() => {
    const presets = readVodPatchPresetsFromStorage();
    setSavedPresets(presets);
    if (presets.length > 0) {
      setSelectedPresetId(presets[0].id);
      setPresetNameInput(presets[0].name);
    }
  }, []);

  useEffect(() => {
    if (!selectedPresetId) return;
    const selected = savedPresets.find((item) => item.id === selectedPresetId);
    if (selected) setPresetNameInput(selected.name);
  }, [savedPresets, selectedPresetId]);

  useEffect(() => {
    if (!presetStatus) return;
    const timeout = window.setTimeout(() => setPresetStatus(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [presetStatus]);

  const streamsWithOverrides = useMemo(() => {
    if (Object.keys(vodOverrides).length === 0) return streams;
    return streams.map((stream) => {
      const key = makeStreamKey(stream.pubkey, stream.streamId);
      const override = vodOverrides[key];
      return override ? { ...stream, vod: override } : stream;
    });
  }, [streams, vodOverrides]);

  const vodStreams = useMemo(() => {
    const base = streamsWithOverrides
      .filter((stream) => stream.status === "ended")
      .filter((stream) => resolveVodPolicy(stream).mode !== "off")
      .filter((stream) => !social.isBlocked(stream.pubkey));
    const byCreator = creatorFilter ? base.filter((stream) => stream.pubkey === creatorFilter) : base;

    const byMode = byCreator.filter((stream) => {
      const policy = resolveVodPolicy(stream);
      if (mode === "all") return true;
      return policy.mode === mode;
    });

    const byFavorites = favoritesOnly
      ? byMode.filter((stream) => social.isFavoriteCreator(stream.pubkey) || social.isFavoriteStream(stream.pubkey, stream.streamId))
      : byMode;

    const q = query.trim().toLowerCase();
    const byQuery = !q
      ? byFavorites
      : byFavorites.filter((stream) => {
          const policy = resolveVodPolicy(stream);
          return (
            (stream.title || "").toLowerCase().includes(q) ||
            (stream.summary || "").toLowerCase().includes(q) ||
            (policy.playlistId || "").toLowerCase().includes(q) ||
            stream.pubkey.toLowerCase().includes(q)
          );
        });

    return byQuery.sort((a, b) => b.createdAt - a.createdAt);
  }, [creatorFilter, favoritesOnly, mode, query, social, streamsWithOverrides]);

  const myVodStreams = useMemo(() => {
    if (!identity) return [];
    return vodStreams.filter((stream) => stream.pubkey === identity.pubkey);
  }, [identity, vodStreams]);

  const sortedMyVodStreams = useMemo(() => {
    const list = [...myVodStreams];
    list.sort((a, b) => {
      if (creatorListSortMode === "newest") return b.createdAt - a.createdAt;
      if (creatorListSortMode === "oldest") return a.createdAt - b.createdAt;

      if (creatorListSortMode === "title_asc" || creatorListSortMode === "title_desc") {
        const byTitle = (a.title || a.streamId).localeCompare(b.title || b.streamId, undefined, { sensitivity: "base" });
        if (byTitle !== 0) return creatorListSortMode === "title_asc" ? byTitle : -byTitle;
        return b.createdAt - a.createdAt;
      }

      const aPlaylist = resolveVodPolicy(a).playlistId?.trim() || "Ungrouped";
      const bPlaylist = resolveVodPolicy(b).playlistId?.trim() || "Ungrouped";
      const byPlaylist = aPlaylist.localeCompare(bPlaylist, undefined, { sensitivity: "base" });
      if (byPlaylist !== 0) return creatorListSortMode === "playlist_asc" ? byPlaylist : -byPlaylist;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [creatorListSortMode, myVodStreams]);

  useEffect(() => {
    setSelectedStreamKeys((prev) => {
      const allowed = new Set(sortedMyVodStreams.map((stream) => makeStreamKey(stream.pubkey, stream.streamId)));
      const next: Record<string, boolean> = {};
      for (const [key, selected] of Object.entries(prev)) {
        if (selected && allowed.has(key)) next[key] = true;
      }
      return next;
    });
  }, [sortedMyVodStreams]);

  const selectedCount = useMemo(
    () => Object.values(selectedStreamKeys).reduce((count, selected) => (selected ? count + 1 : count), 0),
    [selectedStreamKeys]
  );

  const priceAtomicPatch = useMemo(
    () => (pricePatchMode === "set" ? parseXmrAmountToAtomic(priceXmrPatchInput) : null),
    [pricePatchMode, priceXmrPatchInput]
  );
  const pricePatchInvalid = useMemo(
    () => pricePatchMode === "set" && priceAtomicPatch === null,
    [priceAtomicPatch, pricePatchMode]
  );
  const accessHoursPatchParsed = useMemo(() => parsePositiveInt(accessHoursPatchInput), [accessHoursPatchInput]);
  const accessPatchInvalid = useMemo(
    () => accessPatchMode === "set" && accessHoursPatchParsed === null,
    [accessHoursPatchParsed, accessPatchMode]
  );
  const accessSecondsPatch = useMemo(
    () => (accessPatchMode === "set" && accessHoursPatchParsed ? accessHoursPatchParsed * 3600 : null),
    [accessHoursPatchParsed, accessPatchMode]
  );

  const currentPresetValues = useMemo<VodPatchPresetValues>(
    () => ({
      playlistTargetInput: playlistTargetInput.trim(),
      playlistScopePatch,
      vodModePatch,
      pricePatchMode,
      priceXmrPatchInput: priceXmrPatchInput.trim(),
      accessPatchMode,
      accessHoursPatchInput: accessHoursPatchInput.trim()
    }),
    [accessHoursPatchInput, accessPatchMode, playlistScopePatch, playlistTargetInput, pricePatchMode, priceXmrPatchInput, vodModePatch]
  );

  const saveCurrentPreset = useCallback(() => {
    const now = Date.now();
    const requestedName = presetNameInput.trim();
    const existing = selectedPresetId ? savedPresets.find((item) => item.id === selectedPresetId) : null;
    const presetName = requestedName || existing?.name || `Preset ${new Date(now).toLocaleString()}`;

    let next: VodPatchPreset[];
    let nextId = selectedPresetId;
    if (existing) {
      const updated: VodPatchPreset = {
        ...existing,
        name: presetName,
        updatedAt: now,
        values: currentPresetValues
      };
      next = [updated, ...savedPresets.filter((item) => item.id !== selectedPresetId)];
    } else {
      const id = `preset_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      nextId = id;
      const created: VodPatchPreset = {
        id,
        name: presetName,
        createdAt: now,
        updatedAt: now,
        values: currentPresetValues
      };
      next = [created, ...savedPresets].slice(0, 40);
    }

    setSavedPresets(next);
    setSelectedPresetId(nextId);
    setPresetNameInput(presetName);
    writeVodPatchPresetsToStorage(next);
    setPresetStatus(`Saved preset "${presetName}".`);
  }, [currentPresetValues, presetNameInput, savedPresets, selectedPresetId]);

  const loadSelectedPreset = useCallback(() => {
    const preset = savedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      setPresetStatus("Choose a preset to load.");
      return;
    }

    setPlaylistTargetInput(preset.values.playlistTargetInput);
    setPlaylistScopePatch(preset.values.playlistScopePatch);
    setVodModePatch(preset.values.vodModePatch);
    setPricePatchMode(preset.values.pricePatchMode);
    setPriceXmrPatchInput(preset.values.priceXmrPatchInput);
    setAccessPatchMode(preset.values.accessPatchMode);
    setAccessHoursPatchInput(preset.values.accessHoursPatchInput);
    setPresetNameInput(preset.name);
    setPresetStatus(`Loaded preset "${preset.name}".`);
  }, [savedPresets, selectedPresetId]);

  const deleteSelectedPreset = useCallback(() => {
    if (!selectedPresetId) return;
    const next = savedPresets.filter((item) => item.id !== selectedPresetId);
    setSavedPresets(next);
    setSelectedPresetId(next[0]?.id ?? "");
    setPresetNameInput(next[0]?.name ?? "");
    writeVodPatchPresetsToStorage(next);
    setPresetStatus("Deleted preset.");
  }, [savedPresets, selectedPresetId]);

  const applyPlaylistQuickFilter = useCallback((playlistId: string, filterMode: VodModeFilter = "all") => {
    setQuery(playlistId === "Ungrouped" ? "" : playlistId);
    setMode(filterMode);
    setFavoritesOnly(false);
  }, []);

  const clearQuickFilters = useCallback(() => {
    setQuery("");
    setMode("all");
    setFavoritesOnly(false);
  }, []);

  const hasQuickFilters = query.trim().length > 0 || mode !== "all" || favoritesOnly;

  const allMineSelected = useMemo(() => {
    if (sortedMyVodStreams.length === 0) return false;
    return sortedMyVodStreams.every((stream) => selectedStreamKeys[makeStreamKey(stream.pubkey, stream.streamId)]);
  }, [sortedMyVodStreams, selectedStreamKeys]);

  const toggleStreamSelection = useCallback((stream: StreamAnnounce) => {
    const streamKey = makeStreamKey(stream.pubkey, stream.streamId);
    setSelectedStreamKeys((prev) => ({ ...prev, [streamKey]: !prev[streamKey] }));
  }, []);

  const toggleSelectAllMine = useCallback(() => {
    if (sortedMyVodStreams.length === 0) return;
    if (allMineSelected) {
      setSelectedStreamKeys({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const stream of sortedMyVodStreams) {
      next[makeStreamKey(stream.pubkey, stream.streamId)] = true;
    }
    setSelectedStreamKeys(next);
  }, [allMineSelected, sortedMyVodStreams]);

  const executeVodPatch = useCallback(
    async (
      targetStreams: StreamAnnounce[],
      options?: { targetPlaylistId?: string; clearSelectionOnSuccess?: boolean }
    ) => {
      if (!identity) {
        setPlaylistActionError("Connect an identity first to republish your VOD metadata.");
        return;
      }
      if (targetStreams.length === 0) {
        setPlaylistActionError("Select at least one replay.");
        return;
      }

      const targetPlaylistId = (options?.targetPlaylistId ?? playlistTargetInput).trim();
      if (pricePatchInvalid) {
        setPlaylistActionError("Invalid paid replay price patch (use a positive XMR amount with up to 12 decimals).");
        return;
      }
      if (accessPatchInvalid) {
        setPlaylistActionError("Invalid access window patch (use a positive integer number of hours).");
        return;
      }

      const wouldTouchPaid =
        vodModePatch === "paid" ||
        (vodModePatch === "keep" && targetStreams.some((stream) => resolveVodPolicy(stream).mode === "paid"));
      if (playlistScopePatch === "playlist" && !targetPlaylistId && wouldTouchPaid) {
        setPlaylistActionError("Playlist scope requires a playlist ID.");
        return;
      }
      if (vodModePatch === "paid" && pricePatchMode !== "set") {
        const missingPrice = targetStreams.some((stream) => {
          const policy = resolveVodPolicy(stream);
          return policy.mode !== "paid" || !policy.priceAtomic;
        });
        if (missingPrice) {
          setPlaylistActionError("Forcing paid replay requires setting a paid price patch for selected streams without an existing paid price.");
          return;
        }
      }

      setPlaylistActionBusy(true);
      setPlaylistActionError(null);
      setPlaylistActionResult(null);

      let success = 0;
      const failures: string[] = [];

      for (const stream of targetStreams) {
        try {
          const nextVod = buildUpdatedVodPolicy(
            stream,
            targetPlaylistId,
            playlistScopePatch,
            vodModePatch,
            pricePatchMode,
            priceAtomicPatch ? priceAtomicPatch.toString() : null,
            accessPatchMode,
            accessSecondsPatch
          );
          const unsigned: any = buildStreamAnnounceEvent({
            pubkey: identity.pubkey,
            createdAt: Math.floor(Date.now() / 1000),
            streamId: stream.streamId,
            title: stream.title || stream.streamId,
            status: stream.status,
            summary: stream.summary,
            image: stream.image,
            streaming: stream.streaming,
            xmr: stream.xmr,
            manifestSignerPubkey: stream.manifestSignerPubkey,
            stakeAmountAtomic: stream.stakeAmountAtomic,
            stakeNote: stream.stakeNote,
            vod: nextVod,
            captions: stream.captions,
            renditions: stream.renditions,
            topics: stream.topics
          });
          const signed = await signEvent(unsigned);
          const report = await publishEventDetailed(relays, signed, { timeoutMs: 10_000 });
          if (!report.ok) {
            const reason = report.failedRelays[0]?.reason ?? "no relay acknowledged update";
            throw new Error(reason);
          }

          setVodOverrides((prev) => ({
            ...prev,
            [makeStreamKey(stream.pubkey, stream.streamId)]: nextVod
          }));
          success += 1;
        } catch (error: any) {
          failures.push(`${stream.streamId}: ${error?.message ?? "failed to republish"}`);
        }
      }

      setPlaylistActionResult({ success, failures });
      if (options?.clearSelectionOnSuccess && success > 0 && failures.length === 0) {
        setSelectedStreamKeys({});
      }
      setPlaylistActionBusy(false);
    },
    [
      accessPatchInvalid,
      accessPatchMode,
      accessSecondsPatch,
      identity,
      playlistScopePatch,
      playlistTargetInput,
      priceAtomicPatch,
      pricePatchInvalid,
      pricePatchMode,
      relays,
      signEvent,
      vodModePatch
    ]
  );

  const applyPlaylistPatch = useCallback(async () => {
    const targetStreams = sortedMyVodStreams.filter((stream) => selectedStreamKeys[makeStreamKey(stream.pubkey, stream.streamId)]);
    await executeVodPatch(targetStreams, { clearSelectionOnSuccess: true });
  }, [executeVodPatch, selectedStreamKeys, sortedMyVodStreams]);

  const playlistSummaries = useMemo(() => {
    const buckets = new Map<
      string,
      {
        total: number;
        paid: number;
        mine: number;
        latestCreatedAt: number;
      }
    >();

    for (const stream of vodStreams) {
      const policy = resolveVodPolicy(stream);
      const playlist = policy.playlistId?.trim() || "Ungrouped";
      const current = buckets.get(playlist) ?? { total: 0, paid: 0, mine: 0, latestCreatedAt: 0 };
      current.total += 1;
      if (policy.mode === "paid") current.paid += 1;
      if (identity && stream.pubkey === identity.pubkey) current.mine += 1;
      current.latestCreatedAt = Math.max(current.latestCreatedAt, stream.createdAt);
      buckets.set(playlist, current);
    }

    const list = Array.from(buckets.entries()).map(([playlistId, meta]) => ({ playlistId, ...meta }));
    list.sort((a, b) => {
      if (playlistSortMode === "latest") return b.latestCreatedAt - a.latestCreatedAt;
      if (playlistSortMode === "size_desc") {
        if (b.total !== a.total) return b.total - a.total;
        return b.latestCreatedAt - a.latestCreatedAt;
      }
      if (playlistSortMode === "size_asc") {
        if (a.total !== b.total) return a.total - b.total;
        return b.latestCreatedAt - a.latestCreatedAt;
      }
      const byName = a.playlistId.localeCompare(b.playlistId, undefined, { sensitivity: "base" });
      return playlistSortMode === "name_asc" ? byName : -byName;
    });
    return list;
  }, [identity, playlistSortMode, vodStreams]);

  const selectMineForPlaylist = useCallback(
    (playlistId: string, mode: "only" | "add" = "only") => {
      if (!identity) return;
      const matching = sortedMyVodStreams.filter((stream) => {
        const value = resolveVodPolicy(stream).playlistId?.trim() || "Ungrouped";
        return value === playlistId;
      });
      if (matching.length === 0) return;
      setSelectedStreamKeys((prev) => {
        const base = mode === "add" ? { ...prev } : {};
        for (const stream of matching) {
          base[makeStreamKey(stream.pubkey, stream.streamId)] = true;
        }
        return base;
      });
    },
    [identity, sortedMyVodStreams]
  );

  const applyPresetToPlaylist = useCallback(
    async (playlistId: string) => {
      if (!identity) return;
      const matching = sortedMyVodStreams.filter((stream) => {
        const value = resolveVodPolicy(stream).playlistId?.trim() || "Ungrouped";
        return value === playlistId;
      });
      if (matching.length === 0) {
        setPlaylistActionError("No creator-owned replay items were found in that playlist.");
        return;
      }

      const currentTarget = playlistTargetInput.trim();
      const fallbackPlaylistId = playlistId === "Ungrouped" ? "" : playlistId;
      await executeVodPatch(matching, {
        targetPlaylistId: currentTarget || fallbackPlaylistId
      });
    },
    [executeVodPatch, identity, playlistTargetInput, sortedMyVodStreams]
  );

  const refreshEntitlements = useCallback(() => {
    setEntitlements(readVodEntitlementsFromStorage());
  }, []);

  useEffect(() => {
    refreshEntitlements();
    const onStorage = () => refreshEntitlements();
    const onFocus = () => refreshEntitlements();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshEntitlements]);

  const visibleEntitlements = useMemo(() => {
    const currentPubkey = identity?.pubkey ?? null;
    return entitlements.filter((entry) => {
      if (!showExpiredEntitlements && entry.expired) return false;
      if (mineOnlyEntitlements && currentPubkey && entry.pubkey !== currentPubkey) return false;
      return true;
    });
  }, [entitlements, identity?.pubkey, mineOnlyEntitlements, showExpiredEntitlements]);

  const clearEntitlement = useCallback(
    (key: string) => {
      localStorage.removeItem(key);
      refreshEntitlements();
    },
    [refreshEntitlements]
  );

  const clearExpiredEntitlements = useCallback(() => {
    for (const entry of entitlements) {
      if (entry.expired) localStorage.removeItem(entry.key);
    }
    refreshEntitlements();
  }, [entitlements, refreshEntitlements]);

  const clearAllEntitlements = useCallback(() => {
    for (const entry of entitlements) {
      localStorage.removeItem(entry.key);
    }
    refreshEntitlements();
  }, [entitlements, refreshEntitlements]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-[1800px] mx-auto p-8 space-y-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-bold">VOD Hub</h1>
            <div className="text-sm text-neutral-400">{vodStreams.length} replay items</div>
          </div>
          {creatorFilter && (
            <div className="text-xs text-neutral-500">
              Creator filter:{" "}
              <span className="font-mono text-neutral-300">{shortenText(creatorFilterNpub ?? creatorFilter, { head: 18, tail: 10 })}</span>{" "}
              ·{" "}
              <Link href="/vod" className="text-blue-300 hover:text-blue-200">
                clear
              </Link>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 items-center">
            <label className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
              <Search className="w-4 h-4 text-neutral-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, playlist, creator…"
                className="w-full bg-transparent text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none"
              />
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as VodModeFilter)}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All modes</option>
              <option value="public">Public only</option>
              <option value="paid">Paid only</option>
            </select>
            <label className="inline-flex items-center gap-2 text-xs text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
                className="accent-blue-500"
              />
              Favorites only
            </label>
            <button
              type="button"
              onClick={clearQuickFilters}
              disabled={!hasQuickFilters}
              className="px-3 py-2 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reset filters
            </button>
          </div>
        </header>

        <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Creator Playlist Manager</h2>
            <div className="text-xs text-neutral-500">{myVodStreams.length} replay item{myVodStreams.length === 1 ? "" : "s"} owned by your current identity</div>
          </div>
          {!identity ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm text-neutral-500">
              Connect an identity to republish playlist metadata for your replays.
            </div>
          ) : myVodStreams.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm text-neutral-500">
              No replay items from your active identity are currently visible.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px_auto] gap-3 items-end">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Playlist ID (leave blank to clear playlist assignment)</div>
                  <input
                    value={playlistTargetInput}
                    onChange={(e) => setPlaylistTargetInput(e.target.value)}
                    placeholder="example: season-1"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Paid VOD scope patch</div>
                  <select
                    value={playlistScopePatch}
                    onChange={(e) => setPlaylistScopePatch(e.target.value as ScopePatchMode)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="keep">Keep existing scope</option>
                    <option value="stream">Force stream scope</option>
                    <option value="playlist">Force playlist scope</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void applyPlaylistPatch()}
                  disabled={playlistActionBusy || selectedCount === 0}
                  className="px-4 py-2 rounded-xl border border-neutral-700 bg-blue-600/80 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 text-sm"
                >
                  {playlistActionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {playlistActionBusy ? "Republishing…" : "Republish selected"}
                </button>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_auto_auto_auto] gap-3 items-end">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Saved patch presets</div>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select preset…</option>
                    {savedPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Preset name</div>
                  <input
                    value={presetNameInput}
                    onChange={(e) => setPresetNameInput(e.target.value)}
                    placeholder="my paid playlist preset"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={loadSelectedPreset}
                  disabled={!selectedPresetId}
                  className="px-3 py-2 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={saveCurrentPreset}
                  className="px-3 py-2 rounded-xl border border-emerald-700/70 bg-emerald-950/30 hover:bg-emerald-900/30 text-xs text-emerald-200"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedPreset}
                  disabled={!selectedPresetId}
                  className="px-3 py-2 rounded-xl border border-red-700/70 bg-red-950/30 hover:bg-red-900/30 text-xs text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </div>
              {presetStatus ? <div className="text-xs text-blue-200">{presetStatus}</div> : null}
              <div className="grid grid-cols-1 lg:grid-cols-[200px_180px_minmax(0,1fr)_180px_minmax(0,1fr)] gap-3 items-end">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Replay mode patch</div>
                  <select
                    value={vodModePatch}
                    onChange={(e) => setVodModePatch(e.target.value as VodModePatch)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="keep">Keep existing</option>
                    <option value="public">Force public replay</option>
                    <option value="paid">Force paid replay</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Paid price patch</div>
                  <select
                    value={pricePatchMode}
                    onChange={(e) => setPricePatchMode(e.target.value as PricePatchMode)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="keep">Keep existing</option>
                    <option value="set">Set price</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Paid price (XMR)</div>
                  <input
                    value={priceXmrPatchInput}
                    onChange={(e) => setPriceXmrPatchInput(e.target.value)}
                    placeholder="0.05"
                    disabled={pricePatchMode !== "set"}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Access window patch</div>
                  <select
                    value={accessPatchMode}
                    onChange={(e) => setAccessPatchMode(e.target.value as AccessWindowPatchMode)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="keep">Keep existing</option>
                    <option value="set">Set window</option>
                    <option value="clear">Clear window</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-400">Access window (hours)</div>
                  <input
                    value={accessHoursPatchInput}
                    onChange={(e) => setAccessHoursPatchInput(e.target.value)}
                    placeholder="24"
                    disabled={accessPatchMode !== "set"}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  />
                </label>
              </div>
              {(pricePatchInvalid || accessPatchInvalid) && (
                <div className="text-xs text-red-300">
                  {pricePatchInvalid ? "Invalid paid replay price patch. " : ""}
                  {accessPatchInvalid ? "Invalid access window patch." : ""}
                </div>
              )}
              {playlistActionError ? <div className="text-xs text-red-300">{playlistActionError}</div> : null}
              {playlistActionResult ? (
                <div className="text-xs text-neutral-400 space-y-1">
                  <div className="text-neutral-300">
                    Published updates: {playlistActionResult.success} success, {playlistActionResult.failures.length} failed.
                  </div>
                  {playlistActionResult.failures.length > 0 ? (
                    <div className="rounded-lg border border-red-800/60 bg-red-950/30 p-2 text-red-200 space-y-1 max-h-40 overflow-auto">
                      {playlistActionResult.failures.map((failure) => (
                        <div key={failure} className="font-mono text-[11px]">
                          {failure}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllMine}
                    className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200"
                  >
                    {allMineSelected ? "Clear selection" : "Select all"}
                  </button>
                  <label className="inline-flex items-center gap-2 text-neutral-400">
                    Sort
                    <select
                      value={creatorListSortMode}
                      onChange={(e) => setCreatorListSortMode(e.target.value as CreatorListSortMode)}
                      className="bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-neutral-200"
                    >
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="title_asc">Title A→Z</option>
                      <option value="title_desc">Title Z→A</option>
                      <option value="playlist_asc">Playlist A→Z</option>
                      <option value="playlist_desc">Playlist Z→A</option>
                    </select>
                  </label>
                </div>
                <div className="text-neutral-500">{selectedCount} selected</div>
              </div>
              <div className="max-h-72 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/40 divide-y divide-neutral-800">
                {sortedMyVodStreams.map((stream) => {
                  const streamKey = makeStreamKey(stream.pubkey, stream.streamId);
                  const policy = resolveVodPolicy(stream);
                  const isSelected = !!selectedStreamKeys[streamKey];
                  return (
                    <label key={`manage:${streamKey}`} className="flex items-start gap-3 px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleStreamSelection(stream)}
                        className="accent-blue-500 mt-1"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-100 truncate">{stream.title || stream.streamId}</div>
                        <div className="text-[11px] text-neutral-500">
                          {vodModeLabel(policy)} · playlist {(policy.playlistId ?? "Ungrouped")} · {new Date(stream.createdAt * 1000).toLocaleString()}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Local VOD Access Entitlements</h2>
            <button
              type="button"
              onClick={refreshEntitlements}
              className="px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-300">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showExpiredEntitlements}
                onChange={(e) => setShowExpiredEntitlements(e.target.checked)}
                className="accent-blue-500"
              />
              Show expired
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={mineOnlyEntitlements}
                onChange={(e) => setMineOnlyEntitlements(e.target.checked)}
                className="accent-blue-500"
              />
              Mine only
            </label>
            <button
              type="button"
              onClick={clearExpiredEntitlements}
              className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
            >
              Clear expired
            </button>
            <button
              type="button"
              onClick={clearAllEntitlements}
              className="px-2 py-1 rounded-lg border border-red-700/80 bg-red-950/30 hover:bg-red-900/40 text-red-200"
            >
              Clear all
            </button>
          </div>
          {visibleEntitlements.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm text-neutral-500">No matching local entitlements.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {visibleEntitlements.map((entry) => {
                const npub = pubkeyHexToNpub(entry.pubkey);
                return (
                  <div key={entry.key} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-neutral-300 truncate">{shortenText(npub ?? entry.pubkey, { head: 16, tail: 8 })}</div>
                      <button
                        type="button"
                        onClick={() => clearEntitlement(entry.key)}
                        className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="text-neutral-400">
                      {entry.kind === "playlist" ? "Playlist unlock" : "Stream unlock"}:{" "}
                      <span className="font-mono text-neutral-200">{entry.targetId}</span>
                    </div>
                    <div className="text-neutral-500">
                      Scope {entry.accessScope}
                      {entry.playlistId ? ` · playlist ${entry.playlistId}` : ""}
                      {" · "}
                      expires {new Date(entry.expMs).toLocaleString()}
                      {entry.expired ? " (expired)" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Playlists ({playlistSummaries.length})</h2>
            <label className="inline-flex items-center gap-2 text-xs text-neutral-400">
              Sort
              <select
                value={playlistSortMode}
                onChange={(e) => setPlaylistSortMode(e.target.value as PlaylistSortMode)}
                className="bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1 text-neutral-200"
              >
                <option value="latest">Latest activity</option>
                <option value="size_desc">Most items</option>
                <option value="size_asc">Fewest items</option>
                <option value="name_asc">Name A→Z</option>
                <option value="name_desc">Name Z→A</option>
              </select>
            </label>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-neutral-900 animate-pulse" />
              ))}
            </div>
          ) : playlistSummaries.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 p-6 text-sm text-neutral-500">No playlists found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {playlistSummaries.map((playlist) => (
                <div key={playlist.playlistId} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                  <div className="text-sm text-neutral-100">{playlist.playlistId}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    {playlist.total} item{playlist.total === 1 ? "" : "s"} · {playlist.paid} paid
                  </div>
                  {identity && playlist.mine > 0 ? (
                    <div className="text-xs text-emerald-300 mt-1">
                      {playlist.mine} owned by your active identity
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => applyPlaylistQuickFilter(playlist.playlistId, "all")}
                      className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200"
                    >
                      Filter all
                    </button>
                    {playlist.total > playlist.paid ? (
                      <button
                        type="button"
                        onClick={() => applyPlaylistQuickFilter(playlist.playlistId, "public")}
                        className="px-2 py-1 rounded-lg border border-cyan-700/60 bg-cyan-950/30 hover:bg-cyan-900/30 text-xs text-cyan-200"
                      >
                        Public
                      </button>
                    ) : null}
                    {playlist.paid > 0 ? (
                      <button
                        type="button"
                        onClick={() => applyPlaylistQuickFilter(playlist.playlistId, "paid")}
                        className="px-2 py-1 rounded-lg border border-amber-700/60 bg-amber-950/30 hover:bg-amber-900/30 text-xs text-amber-200"
                      >
                        Paid
                      </button>
                    ) : null}
                    {identity && playlist.mine > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPlaylistTargetInput(playlist.playlistId === "Ungrouped" ? "" : playlist.playlistId)}
                          className="px-2 py-1 rounded-lg border border-blue-700/70 bg-blue-950/30 hover:bg-blue-900/30 text-xs text-blue-200"
                        >
                          Use in editor
                        </button>
                        <button
                          type="button"
                          onClick={() => selectMineForPlaylist(playlist.playlistId, "only")}
                          className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200"
                        >
                          Select mine
                        </button>
                        <button
                          type="button"
                          onClick={() => selectMineForPlaylist(playlist.playlistId, "add")}
                          className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-200"
                        >
                          Add mine
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyPresetToPlaylist(playlist.playlistId)}
                          disabled={playlistActionBusy}
                          className="px-2 py-1 rounded-lg border border-emerald-700/70 bg-emerald-950/30 hover:bg-emerald-900/30 text-xs text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Apply current preset
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Replays</h2>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : vodStreams.length === 0 ? (
            <div className="rounded-xl border border-neutral-800 p-8 text-neutral-400 text-center">No replays match current filters.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {vodStreams.map((stream) => {
                const npub = pubkeyHexToNpub(stream.pubkey);
                const pubkeyParam = npub ?? stream.pubkey;
                const pubkeyLabel = npub
                  ? shortenText(npub, { head: 14, tail: 8 })
                  : shortenText(stream.pubkey, { head: 14, tail: 8 });
                const policy = resolveVodPolicy(stream);
                return (
                  <Link
                    href={`/watch/${pubkeyParam}/${stream.streamId}`}
                    key={`vod:${stream.pubkey}:${stream.streamId}:${stream.createdAt}`}
                    className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition"
                  >
                    <div className="aspect-video bg-neutral-800 relative overflow-hidden">
                      {stream.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={stream.image}
                          alt={stream.title || "Replay thumbnail"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">No thumbnail</div>
                      )}
                      <div className="absolute top-2 left-2 bg-neutral-950/80 border border-neutral-700 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                        {vodModeLabel(policy)}
                      </div>
                      {!!policy.playlistId?.trim() && (
                        <div className="absolute bottom-2 left-2 bg-neutral-950/80 border border-neutral-700 text-neutral-300 text-[10px] px-2 py-0.5 rounded">
                          {policy.playlistId}
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-1">
                      <h3 className="font-bold text-base line-clamp-1">{stream.title || "Untitled Replay"}</h3>
                      <p className="text-xs text-neutral-500 font-mono">{pubkeyLabel}</p>
                      {policy.mode === "paid" && policy.priceAtomic && (
                        <p className="text-xs text-amber-300">Unlock: {formatXmrAtomic(policy.priceAtomic)}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
