"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, LogOut, Plug, Sparkles } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { useProfileChannels } from "@/hooks/useProfileChannels";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";

const LIVE_STALE_SEC = 6 * 60 * 60;

export function IdentityButton() {
  const { identity, isLoading, connectExtension, generateLocal, logout } = useIdentity();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ext" | "local" | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const npub = identity ? pubkeyHexToNpub(identity.pubkey) : null;
  const profileRecord = useNostrProfile(identity?.pubkey);
  const { channels } = useProfileChannels(identity?.pubkey, { fetchLimit: 200, lookbackDays: 30 });

  const displayName = useMemo(() => {
    const profile = profileRecord?.profile;
    if (!profile) return null;
    const value = profile.displayName?.trim() || profile.name?.trim() || "";
    return value || null;
  }, [profileRecord?.profile]);

  const isLive = useMemo(() => {
    if (!identity) return false;
    const staleCutoff = Math.floor(Date.now() / 1000) - LIVE_STALE_SEC;
    return channels.some((channel) => channel.status === "live" && channel.createdAt >= staleCutoff);
  }, [channels, identity]);

  const showCopiedNotice = useCallback(() => {
    setCopied(true);
    if (copiedTimeoutRef.current) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 1800);
  }, []);

  const copyIdentityAddress = useCallback(async () => {
    if (!identity) return false;
    const value = npub ?? identity.pubkey;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      showCopiedNotice();
      return true;
    } catch {
      return false;
    }
  }, [identity, npub, showCopiedNotice]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!rootRef.current?.contains(target)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return <div className="h-8 w-24 rounded-full bg-neutral-800 animate-pulse" />;
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

  const toggleOpen = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      await copyIdentityAddress();
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-full px-3 py-1.5 text-xs sm:text-sm transition-colors whitespace-nowrap leading-none"
      >
        <KeyRound className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-300" />
        {identity ? (
          <>
            {displayName ? (
              <span className={`max-w-[10rem] truncate font-semibold ${isLive ? "text-emerald-300" : "text-blue-300"}`}>{displayName}</span>
            ) : null}
            <span className="font-mono text-neutral-200">{shortenText(npub ?? identity.pubkey, { head: 14, tail: 8 })}</span>
          </>
        ) : (
          <span className="text-neutral-300">Identity</span>
        )}
      </button>

      {isOpen ? (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl p-3 z-50">
          {identity ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-neutral-400">Connected</div>
                {copied ? <div className="text-[11px] text-emerald-300">Copied</div> : <div className="text-[11px] text-neutral-500">Tap address to copy</div>}
              </div>
              <button
                type="button"
                onClick={copyIdentityAddress}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-2 py-1.5 text-left font-mono text-xs text-neutral-200 break-all hover:border-neutral-700 hover:bg-neutral-900"
                aria-label="Copy identity address"
                title="Copy identity address"
              >
                {npub ?? identity.pubkey}
              </button>
              <div className="pt-2">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    logout();
                  }}
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
      ) : null}
    </div>
  );
}
