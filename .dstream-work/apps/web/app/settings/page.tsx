"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { ExternalLink, PlugZap, Trash2 } from "lucide-react";
import { nip19 } from "nostr-tools";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useNostrProfiles } from "@/hooks/useNostrProfiles";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { hexToBytes, shortenText } from "@/lib/encoding";
import { parseStreamFavoriteKey } from "@/lib/social/store";
import { ProfileMetadataEditor } from "@/components/settings/ProfileMetadataEditor";
import {
  getWalletIntegrationsForAsset,
  PAYMENT_ASSET_META,
  PAYMENT_ASSET_ORDER,
  WALLET_INTEGRATIONS,
  type WalletIntegrationId
} from "@/lib/payments/catalog";
import { createPaymentMethodDraft, paymentMethodToDraft, type PaymentMethodDraft, validatePaymentMethodDrafts } from "@/lib/payments/methods";
import { type StreamPaymentAsset } from "@dstream/protocol";
import { LOCAL_RELAY_ENABLED_KEY } from "@/lib/config";
import { getLocalRelay, initLocalRelay, destroyLocalRelay, type LocalRelayStats } from "@/lib/relay/localRelay";
import { loadWeights, saveWeights, exportWeights, importWeights, DEFAULT_WEIGHTS, WEIGHT_LABELS, type FeedWeights } from "@/lib/feed/weights";
import { clearWatchHistory, getWatchHistoryCount } from "@/lib/feed/watchHistory";
import { getSavedAlgorithmId } from "@/lib/feed/registry";

const IDENTITY_STORE_STORAGE_KEY = "dstream_identity_store_v2";
const SOCIAL_STORE_STORAGE_KEY = "dstream_social_v1";
const PROFILE_DRAFTS_STORAGE_KEY = "dstream_profile_drafts_v1";

function formatPubkeyLabel(pubkeyHex: string, alias?: string | null) {
  const npub = pubkeyHexToNpub(pubkeyHex);
  const base = npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(pubkeyHex, { head: 14, tail: 8 });
  return alias ? `${alias} (${base})` : base;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseStorageSnapshot(value: unknown): Record<string, string> | null {
  if (!isPlainRecord(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== "string" || !key) continue;
    if (typeof raw === "string") {
      entries.push([key, raw]);
      continue;
    }
    if (raw === null || raw === undefined) {
      entries.push([key, ""]);
      continue;
    }
    try {
      entries.push([key, JSON.stringify(raw)]);
    } catch {
      entries.push([key, String(raw)]);
    }
  }
  return Object.fromEntries(entries);
}

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

interface IdentityStoreBackupSnapshot {
  active: { kind: "extension" | "local"; pubkey: string } | null;
  localIdentities: Array<{
    pubkey: string;
    label: string | null;
    createdAt: number;
    secretKeyHex: string;
    nsec: string | null;
  }>;
}

function parseIdentityStoreBackupSnapshot(raw: string | null | undefined): IdentityStoreBackupSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return null;
    if (parsed.version !== 2) return null;

    const activeRaw = parsed.active;
    let active: IdentityStoreBackupSnapshot["active"] = null;
    if (isPlainRecord(activeRaw)) {
      const kind = activeRaw.kind;
      const pubkey = typeof activeRaw.pubkey === "string" ? activeRaw.pubkey.trim().toLowerCase() : "";
      if ((kind === "extension" || kind === "local") && isHex64(pubkey)) {
        active = { kind, pubkey };
      }
    }

    const localsRaw = parsed.locals;
    if (!isPlainRecord(localsRaw)) return { active, localIdentities: [] };
    const localIdentities = Object.entries(localsRaw)
      .map(([pubkeyRaw, value]) => {
        const pubkey = (pubkeyRaw ?? "").trim().toLowerCase();
        if (!isHex64(pubkey)) return null;
        if (!isPlainRecord(value)) return null;
        const secretKeyHex = typeof value.secretKeyHex === "string" ? value.secretKeyHex.trim().toLowerCase() : "";
        if (!isHex64(secretKeyHex)) return null;
        const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? Math.floor(value.createdAt) : 0;
        const label = typeof value.label === "string" ? value.label : null;
        let nsec: string | null = null;
        try {
          nsec = nip19.nsecEncode(hexToBytes(secretKeyHex));
        } catch {
          nsec = null;
        }
        return { pubkey, label, createdAt, secretKeyHex, nsec };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .sort((a, b) => a.createdAt - b.createdAt);

    return { active, localIdentities };
  } catch {
    return null;
  }
}

function countProfileDraftEntries(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return 0;
    return Object.keys(parsed).filter((key) => isHex64(key)).length;
  } catch {
    return 0;
  }
}

function parseLocalBackupPayload(input: unknown): {
  exportedAt: string | null;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  version: number;
  localIdentityCount: number;
  profileSnapshotCount: number;
  profileDraftCount: number;
} | null {
  if (!isPlainRecord(input)) return null;
  const version = input.version;
  if (version !== 1 && version !== 2) return null;
  const storage = input.storage;
  if (!isPlainRecord(storage)) return null;

  const localStorageSnapshot = parseStorageSnapshot(storage.localStorage);
  if (!localStorageSnapshot) return null;

  const sessionStorageSnapshot = parseStorageSnapshot(storage.sessionStorage) ?? {};
  const exportedAt = typeof input.exportedAt === "string" ? input.exportedAt : null;
  const identitySnapshot = parseIdentityStoreBackupSnapshot(localStorageSnapshot[IDENTITY_STORE_STORAGE_KEY] ?? null);
  const summary = isPlainRecord(input.summary) ? input.summary : null;
  const snapshot = isPlainRecord(input.snapshot) ? input.snapshot : null;
  const profilesByPubkey =
    snapshot && isPlainRecord(snapshot.profilesByPubkey) ? Object.keys(snapshot.profilesByPubkey).filter((pubkey) => isHex64(pubkey)) : [];
  const localIdentityCount =
    summary && typeof summary.localIdentityCount === "number" && Number.isFinite(summary.localIdentityCount)
      ? Math.max(0, Math.floor(summary.localIdentityCount))
      : identitySnapshot?.localIdentities.length ?? 0;
  const profileSnapshotCount =
    summary && typeof summary.profileSnapshotCount === "number" && Number.isFinite(summary.profileSnapshotCount)
      ? Math.max(0, Math.floor(summary.profileSnapshotCount))
      : profilesByPubkey.length;
  const profileDraftCount =
    summary && typeof summary.profileDraftCount === "number" && Number.isFinite(summary.profileDraftCount)
      ? Math.max(0, Math.floor(summary.profileDraftCount))
      : countProfileDraftEntries(localStorageSnapshot[PROFILE_DRAFTS_STORAGE_KEY] ?? null);

  return {
    exportedAt,
    localStorage: localStorageSnapshot,
    sessionStorage: sessionStorageSnapshot,
    version,
    localIdentityCount,
    profileSnapshotCount,
    profileDraftCount
  };
}

function walletModeLabel(mode: "native_app" | "browser_extension" | "external_cli") {
  if (mode === "browser_extension") return "Browser extension";
  if (mode === "external_cli") return "CLI / RPC";
  return "Native app";
}

function walletModeHint(mode: "native_app" | "browser_extension" | "external_cli") {
  if (mode === "browser_extension") return "Use browser plugin confirmation when opening wallet URI from Watch page.";
  if (mode === "external_cli") return "Use local CLI/RPC workflow; copy address from Watch page and submit externally.";
  return "Open the native wallet app and send to the copied address or wallet URI target.";
}

function FeedWeightEditor() {
  const [weights, setWeights] = useState<FeedWeights>(() => loadWeights());
  const [historyCount, setHistoryCount] = useState(0);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getWatchHistoryCount().then(setHistoryCount);
  }, []);

  const updateWeight = useCallback((key: keyof FeedWeights, value: number) => {
    setWeights((prev) => {
      const next = { ...prev, [key]: value };
      saveWeights(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setWeights({ ...DEFAULT_WEIGHTS });
    saveWeights(DEFAULT_WEIGHTS);
    setNotice("Reset to defaults.");
  }, []);

  const handleExport = useCallback(() => {
    const json = exportWeights(weights);
    void navigator.clipboard.writeText(json).then(() => setNotice("Copied to clipboard."));
  }, [weights]);

  const handleImport = useCallback(() => {
    setImportError(null);
    const result = importWeights(importText);
    if (!result) {
      setImportError("Invalid feed weights JSON.");
      return;
    }
    setWeights(result);
    saveWeights(result);
    setImportText("");
    setNotice("Imported successfully.");
  }, [importText]);

  const handleClearHistory = useCallback(() => {
    void clearWatchHistory().then(() => {
      setHistoryCount(0);
      setNotice("Watch history cleared.");
    });
  }, []);

  return (
    <div className="border-t border-neutral-800 pt-4 mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Feed Algorithm Weights</h3>
        <span className="text-xs text-neutral-500">Active: {getSavedAlgorithmId()}</span>
      </div>
      <p className="text-xs text-neutral-500">
        Tune how the &quot;For You&quot; feed ranks streams. Changes apply immediately.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(WEIGHT_LABELS) as (keyof FeedWeights)[]).map((key) => {
          const meta = WEIGHT_LABELS[key];
          return (
            <label key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">{meta.label}</span>
                <span className="text-xs font-mono text-neutral-300">{weights[key]}</span>
              </div>
              <input
                type="range"
                min={meta.min}
                max={meta.max}
                step={meta.step}
                value={weights[key]}
                onChange={(e) => updateWeight(key, Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="text-[10px] text-neutral-600">{meta.description}</div>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button onClick={resetToDefaults} className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300">
          Reset to defaults
        </button>
        <button onClick={handleExport} className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300">
          Export (copy JSON)
        </button>
        <button onClick={handleClearHistory} className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300">
          Clear watch history ({historyCount})
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setImportError(null); }}
            placeholder='Paste feed weights JSON to import...'
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-600"
          />
          <button
            onClick={handleImport}
            disabled={!importText.trim()}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium"
          >
            Import
          </button>
        </div>
        {importError && <div className="text-xs text-red-400">{importError}</div>}
      </div>

      {notice && <div className="text-xs text-emerald-300">{notice}</div>}
    </div>
  );
}

function LocalRelayToggle({ ownerPubkey }: { ownerPubkey: string | null }) {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(LOCAL_RELAY_ENABLED_KEY) === "1"; } catch { return false; }
  });
  const [stats, setStats] = useState<LocalRelayStats | null>(null);

  useEffect(() => {
    if (!enabled || !ownerPubkey) {
      destroyLocalRelay();
      setStats(null);
      return;
    }
    let cancelled = false;
    initLocalRelay(ownerPubkey).then((relay) => {
      if (cancelled) return;
      setStats(relay.getStats());
    });
    return () => { cancelled = true; };
  }, [enabled, ownerPubkey]);

  // Refresh stats every 10s while enabled.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const relay = getLocalRelay();
      if (relay) setStats(relay.getStats());
    }, 10_000);
    return () => clearInterval(interval);
  }, [enabled]);

  const toggle = useCallback((checked: boolean) => {
    try { localStorage.setItem(LOCAL_RELAY_ENABLED_KEY, checked ? "1" : "0"); } catch { /* */ }
    setEnabled(checked);
  }, []);

  return (
    <div className="border-t border-neutral-800 pt-4 mt-4 space-y-2">
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="accent-blue-500"
        />
        Local relay (stores your events on-device)
      </label>
      <p className="text-xs text-neutral-500 pl-5">
        Keeps your stream announces, chat, and presence in local storage so they&apos;re available even if remote relays drop them. Only stores events from your own identity.
      </p>
      {enabled && stats && (
        <div className="text-xs text-neutral-500 pl-5 font-mono">
          {stats.eventCount} event{stats.eventCount !== 1 ? "s" : ""} stored
          {stats.eventCount > 0 && (
            <span className="ml-2">
              ({Object.entries(stats.kinds).map(([k, v]) => `kind ${k}: ${v}`).join(", ")})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const {
    identity,
    isLoading: identityLoading,
    localIdentities,
    connectExtension,
    generateLocal,
    importLocalSecret,
    exportLocalSecret,
    switchLocalIdentity,
    removeLocalIdentity,
    setLocalIdentityLabel,
    exportIdentityStore,
    logout
  } = useIdentity();
  const social = useSocial();

  const [aliasPubkey, setAliasPubkey] = useState("");
  const [aliasValue, setAliasValue] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);

  const [trustedInput, setTrustedInput] = useState("");
  const [trustedError, setTrustedError] = useState<string | null>(null);

  const [mutedInput, setMutedInput] = useState("");
  const [mutedError, setMutedError] = useState<string | null>(null);

  const [blockedInput, setBlockedInput] = useState("");
  const [blockedError, setBlockedError] = useState<string | null>(null);

  const [favoriteCreatorInput, setFavoriteCreatorInput] = useState("");
  const [favoriteCreatorError, setFavoriteCreatorError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState<"extension" | "generate" | "import" | null>(null);
  const [importSecret, setImportSecret] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [exportCopyState, setExportCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetModalStep, setResetModalStep] = useState<"backup" | "confirm">("backup");
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  const [restorePending, setRestorePending] = useState<{
    fileName: string;
    exportedAt: string | null;
    version: number;
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
    dstreamKeyCount: number;
    localIdentityCount: number;
    profileSnapshotCount: number;
    profileDraftCount: number;
  } | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [defaultPaymentDrafts, setDefaultPaymentDrafts] = useState<PaymentMethodDraft[]>([]);
  const [defaultPaymentsError, setDefaultPaymentsError] = useState<string | null>(null);
  const [defaultPaymentsNotice, setDefaultPaymentsNotice] = useState<string | null>(null);

  const settings = social.settings;
  const activeSecretHex = useMemo(() => (identity?.kind === "local" ? exportLocalSecret() : null), [exportLocalSecret, identity?.kind]);
  const activeSecretNsec = useMemo(() => {
    if (!activeSecretHex) return null;
    try {
      return nip19.nsecEncode(hexToBytes(activeSecretHex));
    } catch {
      return null;
    }
  }, [activeSecretHex]);

  const backupIdentityPubkeys = useMemo(() => {
    const set = new Set<string>();
    if (identity?.pubkey) set.add(identity.pubkey.toLowerCase());
    for (const entry of localIdentities) {
      const pubkey = (entry.pubkey ?? "").trim().toLowerCase();
      if (isHex64(pubkey)) set.add(pubkey);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [identity?.pubkey, localIdentities]);

  const backupProfilesByPubkey = useNostrProfiles(backupIdentityPubkeys);

  const favoriteStreams = useMemo(() => {
    return social.state.favorites.streams
      .map((k) => ({ k, parsed: parseStreamFavoriteKey(k) }))
      .filter((v) => !!v.parsed) as Array<{ k: string; parsed: { streamPubkeyHex: string; streamId: string } }>;
  }, [social.state.favorites.streams]);

  const walletIntegrationsByMode = useMemo(() => {
    const modes: Array<"native_app" | "browser_extension" | "external_cli"> = ["native_app", "browser_extension", "external_cli"];
    return modes.map((mode) => ({
      mode,
      wallets: WALLET_INTEGRATIONS.filter((wallet) => wallet.mode === mode)
    }));
  }, []);

  useEffect(() => {
    setDefaultPaymentDrafts(settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
  }, [settings.paymentDefaults.paymentMethods]);

  const downloadLocalBackup = useCallback(() => {
    try {
      const localEntries: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (value === null) continue;
        localEntries[key] = value;
      }
      const localStorageData = Object.fromEntries(
        Object.keys(localEntries)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, localEntries[key]])
      );

      localStorageData[SOCIAL_STORE_STORAGE_KEY] = JSON.stringify(social.state);
      localStorageData[IDENTITY_STORE_STORAGE_KEY] = JSON.stringify(exportIdentityStore());

      const sessionEntries: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        const value = sessionStorage.getItem(key);
        if (value === null) continue;
        sessionEntries[key] = value;
      }
      const sessionStorageData = Object.fromEntries(
        Object.keys(sessionEntries)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, sessionEntries[key]])
      );

      const dstreamKeys = Object.keys(localStorageData).filter((key) => key.startsWith("dstream_"));
      const identitySnapshot = parseIdentityStoreBackupSnapshot(localStorageData[IDENTITY_STORE_STORAGE_KEY] ?? null);
      const profileSnapshots: Record<string, { createdAt: number; nip05Verified: boolean | null; profile: unknown }> = {};
      for (const pubkey of backupIdentityPubkeys) {
        const profileRecord = backupProfilesByPubkey[pubkey];
        if (!profileRecord) continue;
        profileSnapshots[pubkey] = {
          createdAt: profileRecord.createdAt,
          nip05Verified: profileRecord.nip05Verified,
          profile: profileRecord.profile
        };
      }
      const profileDraftCount = countProfileDraftEntries(localStorageData[PROFILE_DRAFTS_STORAGE_KEY] ?? null);
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        origin: window.location.origin,
        pathname: window.location.pathname,
        storage: {
          localStorage: localStorageData,
          sessionStorage: sessionStorageData
        },
        snapshot: {
          activeIdentity: identity ? { kind: identity.kind, pubkey: identity.pubkey } : null,
          identity: identitySnapshot,
          profilesByPubkey: profileSnapshots
        },
        summary: {
          localStorageKeys: Object.keys(localStorageData).length,
          sessionStorageKeys: Object.keys(sessionStorageData).length,
          dstreamKeyCount: dstreamKeys.length,
          dstreamKeys,
          localIdentityCount: identitySnapshot?.localIdentities.length ?? 0,
          profileSnapshotCount: Object.keys(profileSnapshots).length,
          profileDraftCount
        }
      };

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `dstream-settings-backup-${stamp}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      return { ok: true as const, fileName };
    } catch (error: any) {
      return { ok: false as const, error: error?.message ?? "Failed to create backup file." };
    }
  }, [backupIdentityPubkeys, backupProfilesByPubkey, exportIdentityStore, identity, social.state]);

  const runLocalReset = useCallback(() => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("dstream_")) keysToRemove.push(key);
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      for (const localIdentity of localIdentities) {
        removeLocalIdentity(localIdentity.pubkey);
      }
      logout();
      social.resetAll();
      setResetNotice(`Local data reset complete. Removed ${keysToRemove.length} dStream storage keys.`);
      setResetError(null);
      return { ok: true as const };
    } catch (error: any) {
      return { ok: false as const, error: error?.message ?? "Failed to reset local data." };
    }
  }, [localIdentities, logout, removeLocalIdentity, social]);

  const openResetModal = useCallback(() => {
    setResetModalOpen(true);
    setResetModalStep("backup");
    setResetError(null);
  }, []);

  const closeResetModal = useCallback(() => {
    setResetModalOpen(false);
    setResetModalStep("backup");
    setResetError(null);
  }, []);

  const handleBackupOnly = useCallback(() => {
    const backup = downloadLocalBackup();
    if (!backup.ok) {
      setResetError(backup.error);
      return;
    }
    setResetError(null);
    setResetNotice(`Backup downloaded: ${backup.fileName}`);
    setResetModalStep("confirm");
  }, [downloadLocalBackup]);

  const handleBackupAndProceed = useCallback(() => {
    const backup = downloadLocalBackup();
    if (!backup.ok) {
      setResetError(backup.error);
      return;
    }
    const reset = runLocalReset();
    if (!reset.ok) {
      setResetError(reset.error);
      return;
    }
    setResetNotice(`Backup downloaded: ${backup.fileName}`);
    closeResetModal();
  }, [closeResetModal, downloadLocalBackup, runLocalReset]);

  const handleConfirmReset = useCallback(() => {
    const reset = runLocalReset();
    if (!reset.ok) {
      setResetError(reset.error);
      return;
    }
    closeResetModal();
  }, [closeResetModal, runLocalReset]);

  const handleRestoreFileSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setRestorePending(null);
    setRestoreNotice(null);
    setRestoreError(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const parsed = parseLocalBackupPayload(JSON.parse(text));
        if (!parsed) {
          setRestoreError("Invalid backup file format. Use a backup exported from this settings panel.");
          return;
        }

        const dstreamKeyCount = Object.keys(parsed.localStorage).filter((key) => key.startsWith("dstream_")).length;
        setRestorePending({
          fileName: file.name,
          exportedAt: parsed.exportedAt,
          version: parsed.version,
          localStorage: parsed.localStorage,
          sessionStorage: parsed.sessionStorage,
          dstreamKeyCount,
          localIdentityCount: parsed.localIdentityCount,
          profileSnapshotCount: parsed.profileSnapshotCount,
          profileDraftCount: parsed.profileDraftCount
        });
      } catch {
        setRestoreError("Invalid backup JSON file.");
      }
    };
    reader.onerror = () => {
      setRestoreError("Failed to read backup file.");
    };
    reader.readAsText(file);
  }, []);

  const clearRestorePending = useCallback(() => {
    setRestorePending(null);
    setRestoreError(null);
  }, []);

  const applyRestoreBackup = useCallback(() => {
    if (!restorePending) return;
    try {
      const localKeysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("dstream_") || Object.prototype.hasOwnProperty.call(restorePending.localStorage, key)) {
          localKeysToRemove.push(key);
        }
      }
      for (const key of localKeysToRemove) {
        localStorage.removeItem(key);
      }
      for (const [key, value] of Object.entries(restorePending.localStorage)) {
        localStorage.setItem(key, value);
      }

      const sessionKeysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        if (key.startsWith("dstream_") || Object.prototype.hasOwnProperty.call(restorePending.sessionStorage, key)) {
          sessionKeysToRemove.push(key);
        }
      }
      for (const key of sessionKeysToRemove) {
        sessionStorage.removeItem(key);
      }
      for (const [key, value] of Object.entries(restorePending.sessionStorage)) {
        sessionStorage.setItem(key, value);
      }

      setRestoreError(null);
      setRestorePending(null);
      setRestoreNotice(`Backup restored from ${restorePending.fileName}. Reloading…`);
      setTimeout(() => {
        window.location.reload();
      }, 250);
    } catch (error: any) {
      setRestoreError(error?.message ?? "Failed to restore backup.");
    }
  }, [restorePending]);

  const updateDefaultPaymentDraft = useCallback((index: number, patch: Partial<PaymentMethodDraft>) => {
    setDefaultPaymentDrafts((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }, []);

  const removeDefaultPaymentDraft = useCallback((index: number) => {
    setDefaultPaymentDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const addDefaultPaymentDraft = useCallback(() => {
    setDefaultPaymentDrafts((prev) => [...prev, createPaymentMethodDraft()]);
  }, []);

  const saveDefaultPaymentMethods = useCallback(() => {
    const result = validatePaymentMethodDrafts(defaultPaymentDrafts);
    if (result.errors.length > 0) {
      setDefaultPaymentsError(result.errors[0] ?? "Invalid payment methods.");
      setDefaultPaymentsNotice(null);
      return;
    }
    social.updateSettings({
      paymentDefaults: {
        ...settings.paymentDefaults,
        paymentMethods: result.methods
      }
    });
    setDefaultPaymentsError(null);
    setDefaultPaymentsNotice(`Saved ${result.methods.length} payment method${result.methods.length === 1 ? "" : "s"}.`);
  }, [defaultPaymentDrafts, settings.paymentDefaults, social]);

  const updatePreferredWallet = useCallback(
    (asset: StreamPaymentAsset, walletIdRaw: string) => {
      const next = { ...(settings.paymentDefaults.preferredWalletByAsset ?? {}) };
      if (!walletIdRaw) {
        delete next[asset];
      } else {
        next[asset] = walletIdRaw as WalletIntegrationId;
      }
      social.updateSettings({
        paymentDefaults: {
          ...settings.paymentDefaults,
          preferredWalletByAsset: next
        }
      });
    },
    [settings.paymentDefaults, social]
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-neutral-500">Local-only (stored in this browser).</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/browse">
            Browse
          </Link>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500 mr-1">Operator Tools:</span>
          <Link
            href="/settings/operations"
            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
          >
            Operations
          </Link>
          <Link
            href="/settings/monetization"
            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
          >
            Monetization
          </Link>
          <Link
            href="/settings/vod"
            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
          >
            VOD Library
          </Link>
          <Link
            href="/pair"
            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
          >
            Pair Mobile App
          </Link>
        </section>

        {social.isLoading || identityLoading ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
            Loading…
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Identity Keys</h2>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={identityBusy !== null}
                  onClick={() => {
                    setIdentityBusy("extension");
                    setIdentityError(null);
                    setIdentityNotice(null);
                    void connectExtension()
                      .then(() => setIdentityNotice("Connected extension identity."))
                      .catch((err: any) => setIdentityError(err?.message ?? "Failed to connect extension."))
                      .finally(() => setIdentityBusy(null));
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-50"
                >
                  {identityBusy === "extension" ? "Connecting…" : "Connect Extension"}
                </button>
                <button
                  type="button"
                  disabled={identityBusy !== null}
                  onClick={() => {
                    setIdentityBusy("generate");
                    setIdentityError(null);
                    setIdentityNotice(null);
                    void generateLocal()
                      .then(() => setIdentityNotice("Generated local identity."))
                      .catch((err: any) => setIdentityError(err?.message ?? "Failed to generate local identity."))
                      .finally(() => setIdentityBusy(null));
                  }}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                >
                  {identityBusy === "generate" ? "Generating…" : "Generate Local"}
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                >
                  Disconnect
                </button>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm">
                <span className="text-neutral-500">Active:</span>{" "}
                {identity ? (
                  <>
                    <span className="text-neutral-200">
                      {identity.kind === "extension" ? "Extension" : "Local"} · {formatPubkeyLabel(identity.pubkey)}
                    </span>
                    {identity.kind === "local" && activeSecretNsec && <span className="text-xs text-neutral-500 ml-2">(export available)</span>}
                  </>
                ) : (
                  <span className="text-neutral-400">None</span>
                )}
              </div>

              <ProfileMetadataEditor />

              <div className="space-y-2">
                <div className="text-xs text-neutral-500">Import local key (nsec… or 64-hex)</div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-2">
                  <input
                    value={importSecret}
                    onChange={(e) => setImportSecret(e.target.value)}
                    placeholder="nsec… or 64-hex secret"
                    className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                  />
                  <input
                    value={importLabel}
                    onChange={(e) => setImportLabel(e.target.value)}
                    placeholder="Optional label"
                    className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={identityBusy !== null}
                    onClick={() => {
                      setIdentityError(null);
                      setIdentityNotice(null);
                      setIdentityBusy("import");
                      const res = importLocalSecret(importSecret, importLabel);
                      if (!res.ok) setIdentityError(res.error);
                      else {
                        setImportSecret("");
                        setImportLabel("");
                        setIdentityNotice(`Imported ${formatPubkeyLabel(res.pubkey)}.`);
                      }
                      setIdentityBusy(null);
                    }}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm disabled:opacity-50"
                  >
                    Import
                  </button>
                </div>
              </div>

              {identity?.kind === "local" && activeSecretNsec && (
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Export active local key</div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
                    <div className="text-xs text-neutral-500">nsec</div>
                    <div className="font-mono text-xs text-neutral-300 break-all">{activeSecretNsec}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExportCopyState("idle");
                          void (async () => {
                            try {
                              if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                              await navigator.clipboard.writeText(activeSecretNsec);
                              setExportCopyState("copied");
                              setTimeout(() => setExportCopyState("idle"), 1200);
                            } catch {
                              setExportCopyState("error");
                              setTimeout(() => setExportCopyState("idle"), 1800);
                            }
                          })();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                      >
                        {exportCopyState === "copied" ? "Copied" : exportCopyState === "error" ? "Copy failed" : "Copy nsec"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-neutral-500">Saved local identities</div>
                {localIdentities.length === 0 ? (
                  <div className="text-sm text-neutral-500">No local identities saved.</div>
                ) : (
                  <div className="space-y-2">
                    {localIdentities.map((entry) => (
                      <div key={entry.pubkey} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 truncate">
                            {entry.label ? `${entry.label} · ` : ""}
                            {formatPubkeyLabel(entry.pubkey)}
                            {entry.isActive && <span className="ml-2 text-xs text-emerald-300">ACTIVE</span>}
                          </div>
                          <div className="text-xs font-mono text-neutral-500 truncate">{entry.pubkey}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!entry.isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                switchLocalIdentity(entry.pubkey);
                                setIdentityNotice(`Switched to ${formatPubkeyLabel(entry.pubkey)}.`);
                                setIdentityError(null);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                            >
                              Use
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const next = prompt("Label", entry.label ?? "") ?? "";
                              setLocalIdentityLabel(entry.pubkey, next);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                          >
                            Label
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              removeLocalIdentity(entry.pubkey);
                              setIdentityNotice("Removed local identity.");
                            }}
                            className="px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-800/50 text-xs text-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {identityError && <div className="text-xs text-red-300">{identityError}</div>}
              {identityNotice && <div className="text-xs text-emerald-300">{identityNotice}</div>}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Playback &amp; P2P</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.presenceEnabled}
                    onChange={(e) => social.updateSettings({ presenceEnabled: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Share presence by default
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.p2pAssistEnabled}
                    onChange={(e) => social.updateSettings({ p2pAssistEnabled: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Enable P2P assist by default (when allowed)
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.playbackAutoplayMuted}
                    onChange={(e) => social.updateSettings({ playbackAutoplayMuted: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Autoplay muted
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.showMatureContent}
                    onChange={(e) => social.updateSettings({ showMatureContent: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Show mature streams
                </label>

                <label className="flex items-center gap-2 select-none">
                  <span className="text-neutral-400">P2P peers</span>
                  <select
                    value={settings.p2pPeerMode}
                    onChange={(e) => social.setP2PPeerMode(e.target.value === "trusted_only" ? "trusted_only" : "any")}
                    className="ml-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm"
                  >
                    <option value="any">Any (default)</option>
                    <option value="trusted_only">Trusted only</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 select-none">
                  <span className="text-neutral-400">Default host mode</span>
                  <select
                    value={settings.broadcastHostMode}
                    onChange={(e) =>
                      social.updateSettings({
                        broadcastHostMode: e.target.value === "host_only" ? "host_only" : "p2p_economy"
                      })
                    }
                    className="ml-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm"
                  >
                    <option value="p2p_economy">P2P Economy</option>
                    <option value="host_only">Host-Only</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 select-none">
                  <span className="text-neutral-400">Default threshold (T)</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={settings.broadcastRebroadcastThreshold}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      if (!Number.isInteger(parsed) || parsed <= 0) return;
                      social.updateSettings({
                        broadcastRebroadcastThreshold: Math.max(1, Math.min(Math.trunc(parsed), 64))
                      });
                    }}
                    className="ml-2 w-24 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm font-mono"
                    disabled={settings.broadcastHostMode === "host_only"}
                  />
                </label>
              </div>

              <LocalRelayToggle ownerPubkey={identity?.pubkey ?? null} />
              <FeedWeightEditor />
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Payment Defaults</h2>
              <div className="grid grid-cols-1 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Default Monero tip address</div>
                  <input
                    value={settings.paymentDefaults.xmrTipAddress}
                    onChange={(e) =>
                      social.updateSettings({
                        paymentDefaults: { ...settings.paymentDefaults, xmrTipAddress: e.target.value }
                      })
                    }
                    placeholder="4..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <div className="text-xs text-neutral-500">Default stake requirement (XMR)</div>
                    <input
                      value={settings.paymentDefaults.stakeXmr}
                      onChange={(e) =>
                        social.updateSettings({
                          paymentDefaults: { ...settings.paymentDefaults, stakeXmr: e.target.value }
                        })
                      }
                      placeholder="0.05"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs text-neutral-500">Default stake note</div>
                    <input
                      value={settings.paymentDefaults.stakeNote}
                      onChange={(e) =>
                        social.updateSettings({
                          paymentDefaults: { ...settings.paymentDefaults, stakeNote: e.target.value }
                        })
                      }
                      placeholder="Optional message shown to viewers"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-neutral-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-neutral-500">Default additional payout methods (for non-XMR assets)</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addDefaultPaymentDraft}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                    >
                      Add method
                    </button>
                    <button
                      type="button"
                      onClick={saveDefaultPaymentMethods}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium"
                    >
                      Save methods
                    </button>
                  </div>
                </div>

                {defaultPaymentDrafts.length === 0 ? (
                  <div className="text-xs text-neutral-500">No extra payout methods configured.</div>
                ) : (
                  <div className="space-y-2">
                    {defaultPaymentDrafts.map((row, index) => (
                      <div key={`payment-default-${index}`} className="grid grid-cols-1 lg:grid-cols-[120px_1fr_130px_130px_130px_auto] gap-2">
                        <select
                          value={row.asset}
                          onChange={(e) => updateDefaultPaymentDraft(index, { asset: e.target.value as StreamPaymentAsset })}
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-xs"
                        >
                          {PAYMENT_ASSET_ORDER.map((asset) => (
                            <option key={asset} value={asset}>
                              {PAYMENT_ASSET_META[asset].symbol}
                            </option>
                          ))}
                        </select>
                        <input
                          value={row.address}
                          onChange={(e) => updateDefaultPaymentDraft(index, { address: e.target.value })}
                          placeholder={PAYMENT_ASSET_META[row.asset].placeholder}
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono"
                        />
                        <input
                          value={row.network}
                          onChange={(e) => updateDefaultPaymentDraft(index, { network: e.target.value })}
                          placeholder="network"
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs"
                        />
                        <input
                          value={row.label}
                          onChange={(e) => updateDefaultPaymentDraft(index, { label: e.target.value })}
                          placeholder="label"
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs"
                        />
                        <input
                          value={row.amount}
                          onChange={(e) => updateDefaultPaymentDraft(index, { amount: e.target.value })}
                          placeholder={row.asset === "btc" ? "amount (btc/sats)" : "amount (optional)"}
                          className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => removeDefaultPaymentDraft(index)}
                          className="px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {defaultPaymentsNotice && <div className="text-xs text-green-300">{defaultPaymentsNotice}</div>}
                {defaultPaymentsError && <div className="text-xs text-red-300">{defaultPaymentsError}</div>}
              </div>

              <div className="pt-3 border-t border-neutral-800 space-y-2">
                <div className="text-xs text-neutral-500">Preferred wallet per asset</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {PAYMENT_ASSET_ORDER.map((asset) => {
                    const supported = getWalletIntegrationsForAsset(asset);
                    return (
                      <label key={`wallet-pref-${asset}`} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 space-y-1">
                        <div className="text-xs text-neutral-400">{PAYMENT_ASSET_META[asset].symbol}</div>
                        <select
                          value={settings.paymentDefaults.preferredWalletByAsset[asset] ?? ""}
                          onChange={(e) => updatePreferredWallet(asset, e.target.value)}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <option value="">No preference</option>
                          {supported.map((wallet) => (
                            <option key={`${asset}-${wallet.id}`} value={wallet.id}>
                              {wallet.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs text-neutral-500">Applied to new broadcasts and available for wallet actions on watch pages.</div>
            </section>

            <section id="wallet-integrations" className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4 scroll-mt-24">
              <h2 className="text-sm font-semibold text-neutral-200 inline-flex items-center gap-2">
                <PlugZap className="w-4 h-4" />
                Wallet Integrations
              </h2>

              <div className="text-sm text-neutral-300 space-y-2">
                <p>
                  This panel defines how wallet actions are surfaced in watch pages. dStream never stores private keys; it only prepares addresses, URI links,
                  and preferred-wallet hints.
                </p>
                <ol className="list-decimal pl-5 text-xs text-neutral-400 space-y-1">
                  <li>Set preferred wallet per asset above in Payment Defaults.</li>
                  <li>Configure payout methods in Broadcast (core + advanced panel).</li>
                  <li>On watch page, viewers use Copy / Wallet URI / Preferred wallet links for settlement.</li>
                </ol>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {walletIntegrationsByMode.map(({ mode, wallets }) => (
                  <article key={mode} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-neutral-500">{walletModeLabel(mode)}</div>
                      <div className="text-xs text-neutral-500 mt-1">{walletModeHint(mode)}</div>
                    </div>
                    <div className="space-y-2">
                      {wallets.map((wallet) => (
                        <div key={wallet.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-neutral-200">{wallet.name}</div>
                            <a
                              href={wallet.website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                            >
                              Site <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            Assets: {wallet.assets.map((asset) => PAYMENT_ASSET_META[asset].symbol).join(", ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <div className="text-xs text-neutral-500">
                Prefer a CLI wallet workflow? Set preferred wallet to Monero CLI / Bitcoin Core, then use Copy on watch page to pay from your terminal wallet.
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Keyring Aliases</h2>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <input
                  value={aliasPubkey}
                  onChange={(e) => setAliasPubkey(e.target.value)}
                  placeholder="npub… or 64-hex"
                  className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                />
                <input
                  value={aliasValue}
                  onChange={(e) => setAliasValue(e.target.value)}
                  placeholder="Alias (e.g. Alice)"
                  className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAliasError(null);
                    const res = social.setAlias(aliasPubkey, aliasValue);
                    if (!res.ok) setAliasError(res.error);
                    else {
                      setAliasPubkey("");
                      setAliasValue("");
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium"
                >
                  Save
                </button>
              </div>
              {aliasError && <div className="text-xs text-red-300">{aliasError}</div>}

              {Object.keys(social.state.aliases).length === 0 ? (
                <div className="text-sm text-neutral-500">No aliases yet.</div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(social.state.aliases)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([pk, alias]) => (
                      <div
                        key={pk}
                        className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 truncate">{formatPubkeyLabel(pk, alias)}</div>
                          <div className="text-xs text-neutral-500 font-mono truncate">{pk}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => social.removeAlias(pk)}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Trust &amp; Blocks</h2>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Trusted peers</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={trustedInput}
                      onChange={(e) => setTrustedInput(e.target.value)}
                      placeholder="npub… or 64-hex"
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTrustedError(null);
                        const res = social.addTrusted(trustedInput);
                        if (!res.ok) setTrustedError(res.error);
                        else setTrustedInput("");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Add
                    </button>
                  </div>
                  {trustedError && <div className="text-xs text-red-300">{trustedError}</div>}

                  {social.state.trustedPubkeys.length === 0 ? (
                    <div className="text-sm text-neutral-500">No trusted peers yet.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {social.state.trustedPubkeys.map((pk) => (
                        <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs">
                          <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                          <button type="button" onClick={() => social.removeTrusted(pk)} className="text-neutral-400 hover:text-white">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Muted (chat/inbox filtering)</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={mutedInput}
                      onChange={(e) => setMutedInput(e.target.value)}
                      placeholder="npub… or 64-hex"
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setMutedError(null);
                        const res = social.addMuted(mutedInput);
                        if (!res.ok) setMutedError(res.error);
                        else setMutedInput("");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Add
                    </button>
                  </div>
                  {mutedError && <div className="text-xs text-red-300">{mutedError}</div>}

                  {social.state.mutedPubkeys.length === 0 ? (
                    <div className="text-sm text-neutral-500">No muted pubkeys.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {social.state.mutedPubkeys.map((pk) => (
                        <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs">
                          <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                          <button type="button" onClick={() => social.removeMuted(pk)} className="text-neutral-400 hover:text-white">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Blocked (hide + exclude from P2P)</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={blockedInput}
                      onChange={(e) => setBlockedInput(e.target.value)}
                      placeholder="npub… or 64-hex"
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setBlockedError(null);
                        const res = social.addBlocked(blockedInput);
                        if (!res.ok) setBlockedError(res.error);
                        else setBlockedInput("");
                      }}
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                    >
                      Add
                    </button>
                  </div>
                  {blockedError && <div className="text-xs text-red-300">{blockedError}</div>}

                  {social.state.blockedPubkeys.length === 0 ? (
                    <div className="text-sm text-neutral-500">No blocked pubkeys.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {social.state.blockedPubkeys.map((pk) => (
                        <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs">
                          <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                          <button type="button" onClick={() => social.removeBlocked(pk)} className="text-neutral-400 hover:text-white">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <h2 className="text-sm font-semibold text-neutral-200">Favorites</h2>

              <div className="space-y-2">
                <div className="text-xs text-neutral-500">Add favorite creator</div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={favoriteCreatorInput}
                    onChange={(e) => setFavoriteCreatorInput(e.target.value)}
                    placeholder="npub… or 64-hex"
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFavoriteCreatorError(null);
                      const pk = pubkeyParamToHex(favoriteCreatorInput);
                      if (!pk) {
                        setFavoriteCreatorError("Invalid pubkey (expected npub… or 64-hex).");
                        return;
                      }
                      if (social.isFavoriteCreator(pk)) {
                        setFavoriteCreatorError("Already favorited.");
                        return;
                      }
                      social.toggleFavoriteCreator(pk);
                      setFavoriteCreatorInput("");
                    }}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  >
                    Add
                  </button>
                </div>
                {favoriteCreatorError && <div className="text-xs text-red-300">{favoriteCreatorError}</div>}
              </div>

              {social.state.favorites.creators.length === 0 && favoriteStreams.length === 0 ? (
                <div className="text-sm text-neutral-500">No favorites yet. Favorite from Browse or Watch.</div>
              ) : (
                <div className="space-y-4">
                  {social.state.favorites.creators.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-500">Creators</div>
                      <div className="flex flex-wrap gap-2">
                        {social.state.favorites.creators.map((pk) => (
                          <div key={pk} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950 border border-neutral-800 text-xs">
                            <span className="font-mono">{formatPubkeyLabel(pk, social.getAlias(pk))}</span>
                            <button type="button" onClick={() => social.toggleFavoriteCreator(pk)} className="text-neutral-400 hover:text-white">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {favoriteStreams.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-500">Streams</div>
                      <div className="space-y-2">
                        {favoriteStreams.map(({ k, parsed }) => (
                          <div
                            key={k}
                            className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-neutral-200 truncate">
                                {formatPubkeyLabel(parsed.streamPubkeyHex, social.getAlias(parsed.streamPubkeyHex))} /{" "}
                                <span className="font-mono text-neutral-400">{parsed.streamId}</span>
                              </div>
                              <div className="text-xs text-neutral-500">
                                <Link
                                  className="hover:text-white"
                                  href={`/watch/${pubkeyHexToNpub(parsed.streamPubkeyHex) ?? parsed.streamPubkeyHex}/${parsed.streamId}`}
                                >
                                  Open watch page
                                </Link>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => social.toggleFavoriteStream(parsed.streamPubkeyHex, parsed.streamId)}
                              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
              <h2 className="text-sm font-semibold text-neutral-200">Danger Zone</h2>
              <div className="text-sm text-neutral-500">
                Clears aliases, trust lists, favorites, profile drafts, identities, and settings from this browser.
              </div>
              <button
                type="button"
                onClick={openResetModal}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-medium w-fit"
              >
                Reset local data
              </button>
              {resetNotice && <div className="text-xs text-green-300">{resetNotice}</div>}
              {resetError && <div className="text-xs text-red-300">{resetError}</div>}

              <div className="pt-3 mt-1 border-t border-neutral-800/80 space-y-2">
                <div className="text-sm text-neutral-500">Restore local data from a backup file exported from this page.</div>
                <input
                  ref={restoreFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRestoreFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => restoreFileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm font-medium w-fit"
                >
                  Load backup data
                </button>

                {restorePending && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
                    <div className="text-xs text-neutral-300">
                      <span className="font-medium">Selected:</span> {restorePending.fileName}
                    </div>
                    <div className="text-xs text-neutral-400">
                      Backup format: v{restorePending.version}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {restorePending.exportedAt ? `Exported: ${new Date(restorePending.exportedAt).toLocaleString()}` : "Exported: unknown"}
                    </div>
                    <div className="text-xs text-neutral-400">
                      Keys: {Object.keys(restorePending.localStorage).length} local / {Object.keys(restorePending.sessionStorage).length} session /{" "}
                      {restorePending.dstreamKeyCount} dStream-local
                    </div>
                    <div className="text-xs text-neutral-400">
                      Identity keys: {restorePending.localIdentityCount} local / Profile snapshots: {restorePending.profileSnapshotCount} / Profile drafts:{" "}
                      {restorePending.profileDraftCount}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={applyRestoreBackup}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium"
                      >
                        Restore now
                      </button>
                      <button
                        type="button"
                        onClick={clearRestorePending}
                        className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {restoreNotice && <div className="text-xs text-green-300">{restoreNotice}</div>}
                {restoreError && <div className="text-xs text-red-300">{restoreError}</div>}
              </div>
            </section>
          </>
        )}
      </main>

      {resetModalOpen && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 space-y-4">
            {resetModalStep === "backup" ? (
              <>
                <h3 className="text-lg font-semibold text-neutral-100">Do you want to back up your settings first?</h3>
                <p className="text-sm text-neutral-400">
                  Backup includes all current browser data for this site, including identity keys, profile drafts/snapshots, stream/session records, and
                  settings.
                </p>
                {resetError && <div className="text-xs text-red-300">{resetError}</div>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleBackupOnly}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetError(null);
                      setResetModalStep("confirm");
                    }}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={handleBackupAndProceed}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
                  >
                    Yes and Proceed
                  </button>
                  <button
                    type="button"
                    onClick={closeResetModal}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-neutral-100">Confirm local reset</h3>
                <p className="text-sm text-neutral-400">
                  This clears local dStream data from this browser. Use backup first if you need to preserve identities, preferences, and stream/session
                  records.
                </p>
                {resetError && <div className="text-xs text-red-300">{resetError}</div>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmReset}
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-medium"
                  >
                    Reset local data
                  </button>
                  <button
                    type="button"
                    onClick={closeResetModal}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
