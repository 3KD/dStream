"use client";

import { useState } from "react";
import { KeyRound, LogOut, Plug, Sparkles } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";

export function IdentityButton() {
  const { identity, isLoading, connectExtension, generateLocal, logout } = useIdentity();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ext" | "local" | null>(null);
  const npub = identity ? pubkeyHexToNpub(identity.pubkey) : null;

  if (isLoading) {
    return <div className="h-9 w-24 rounded-full bg-neutral-800 animate-pulse" />;
  }

  const handleConnectExt = async () => {
    setError(null);
    setBusy("ext");
    try {
      await connectExtension();
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect extension.");
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateLocal = async () => {
    setError(null);
    setBusy("local");
    try {
      await generateLocal();
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate local key.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <details className="group">
        <summary className="list-none cursor-pointer select-none">
          <span className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-full px-3 py-2 text-sm transition-colors">
            <KeyRound className="w-4 h-4 text-neutral-300" />
            {identity ? (
              <span className="font-mono text-neutral-200">
                {shortenText(npub ?? identity.pubkey, { head: 14, tail: 8 })}
              </span>
            ) : (
              <span className="text-neutral-300">Identity</span>
            )}
          </span>
        </summary>

        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl p-3 z-50">
          {identity ? (
            <div className="space-y-2">
              <div className="text-xs text-neutral-400">Connected</div>
              <div className="font-mono text-xs text-neutral-200 break-all">{npub ?? identity.pubkey}</div>
              <div className="pt-2">
                <button
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-neutral-400">
                Use NIP-07 for real keys. Local keys are for dev/testing.
              </div>
              {error && <div className="text-xs text-red-400">{error}</div>}
              <button
                onClick={handleConnectExt}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
              >
                <Plug className="w-4 h-4" />
                {busy === "ext" ? "Connecting…" : "Connect Extension"}
              </button>
              <button
                onClick={handleGenerateLocal}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-50 text-sm"
              >
                <Sparkles className="w-4 h-4" />
                {busy === "local" ? "Generating…" : "Generate Local Key"}
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
