"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { nip19 } from "nostr-tools";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { useNostrProfiles } from "@/hooks/useNostrProfiles";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { hexToBytes, shortenText } from "@/lib/encoding";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { TrustAndBlocksManager } from "@/components/settings/TrustAndBlocksManager";

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


  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Security &amp; Storage</h1>
            <p className="text-sm text-neutral-500">Identity, safety controls, aliases, and local backups.</p>
          </div>
        </header>

        <SettingsNav />

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

            <TrustAndBlocksManager />


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
