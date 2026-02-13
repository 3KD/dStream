"use client";

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { nip19 } from "nostr-tools";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { hexToBytes, shortenText } from "@/lib/encoding";
import { parseStreamFavoriteKey } from "@/lib/social/store";

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

function parseLocalBackupPayload(input: unknown): { exportedAt: string | null; localStorage: Record<string, string>; sessionStorage: Record<string, string> } | null {
  if (!isPlainRecord(input)) return null;
  const version = input.version;
  if (version !== 1) return null;
  const storage = input.storage;
  if (!isPlainRecord(storage)) return null;

  const localStorageSnapshot = parseStorageSnapshot(storage.localStorage);
  if (!localStorageSnapshot) return null;

  const sessionStorageSnapshot = parseStorageSnapshot(storage.sessionStorage) ?? {};
  const exportedAt = typeof input.exportedAt === "string" ? input.exportedAt : null;

  return {
    exportedAt,
    localStorage: localStorageSnapshot,
    sessionStorage: sessionStorageSnapshot
  };
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
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
    dstreamKeyCount: number;
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

  const favoriteStreams = useMemo(() => {
    return social.state.favorites.streams
      .map((k) => ({ k, parsed: parseStreamFavoriteKey(k) }))
      .filter((v) => !!v.parsed) as Array<{ k: string; parsed: { streamPubkeyHex: string; streamId: string } }>;
  }, [social.state.favorites.streams]);

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
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        origin: window.location.origin,
        pathname: window.location.pathname,
        storage: {
          localStorage: localStorageData,
          sessionStorage: sessionStorageData
        },
        summary: {
          localStorageKeys: Object.keys(localStorageData).length,
          sessionStorageKeys: Object.keys(sessionStorageData).length,
          dstreamKeyCount: dstreamKeys.length,
          dstreamKeys
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
  }, []);

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
          localStorage: parsed.localStorage,
          sessionStorage: parsed.sessionStorage,
          dstreamKeyCount
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
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-neutral-500">Local-only (stored in this browser).</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/browse">
            Browse
          </Link>
        </header>

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
              <div className="text-xs text-neutral-500">Applied to new broadcasts (and can be re-applied from the broadcast page).</div>
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
                Clears aliases, trust lists, favorites, and settings from this browser.
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
                      {restorePending.exportedAt ? `Exported: ${new Date(restorePending.exportedAt).toLocaleString()}` : "Exported: unknown"}
                    </div>
                    <div className="text-xs text-neutral-400">
                      Keys: {Object.keys(restorePending.localStorage).length} local / {Object.keys(restorePending.sessionStorage).length} session /{" "}
                      {restorePending.dstreamKeyCount} dStream-local
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
                  Backup includes all current browser data for this site, including stored stream/session records and settings.
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
