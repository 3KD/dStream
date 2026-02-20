"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { serializeProfileContent, type NostrProfile } from "@/lib/profile";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";

const PROFILE_DRAFTS_STORAGE_KEY = "dstream_profile_drafts_v1";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function toDraft(profile: NostrProfile | null | undefined): Required<NostrProfile> {
  return {
    name: profile?.name ?? "",
    displayName: profile?.displayName ?? "",
    about: profile?.about ?? "",
    picture: profile?.picture ?? "",
    banner: profile?.banner ?? "",
    website: profile?.website ?? "",
    nip05: profile?.nip05 ?? ""
  };
}

function readStoredProfileDraft(pubkeyInput: string): Required<NostrProfile> | null {
  const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
  if (!pubkey) return null;
  try {
    const raw = localStorage.getItem(PROFILE_DRAFTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed[pubkey];
    if (!candidate || typeof candidate !== "object") return null;
    return toDraft(candidate as NostrProfile);
  } catch {
    return null;
  }
}

function writeStoredProfileDraft(pubkeyInput: string, draft: Required<NostrProfile>) {
  const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
  if (!pubkey) return;
  try {
    const raw = localStorage.getItem(PROFILE_DRAFTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = parsed && typeof parsed === "object" ? { ...parsed } : {};
    next[pubkey] = toDraft(draft);
    localStorage.setItem(PROFILE_DRAFTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function removeStoredProfileDraft(pubkeyInput: string) {
  const pubkey = (pubkeyInput ?? "").trim().toLowerCase();
  if (!pubkey) return;
  try {
    const raw = localStorage.getItem(PROFILE_DRAFTS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return;
    if (!Object.prototype.hasOwnProperty.call(parsed, pubkey)) return;
    const next = { ...parsed };
    delete next[pubkey];
    if (Object.keys(next).length === 0) {
      localStorage.removeItem(PROFILE_DRAFTS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PROFILE_DRAFTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function ProfileMetadataEditor() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const profileRecord = useNostrProfile(identity?.pubkey);

  const [draft, setDraft] = useState<Required<NostrProfile>>(toDraft(null));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishEventReport | null>(null);

  useEffect(() => {
    if (!identity?.pubkey) {
      setDraft(toDraft(null));
      setDirty(false);
      setStatus("idle");
      setError(null);
      setReport(null);
      return;
    }
    const storedDraft = readStoredProfileDraft(identity.pubkey);
    if (storedDraft) {
      setDraft(storedDraft);
      setDirty(true);
      return;
    }
    if (dirty) return;
    setDraft(toDraft(profileRecord?.profile));
  }, [dirty, identity?.pubkey, profileRecord?.profile]);

  useEffect(() => {
    if (!identity?.pubkey) return;
    if (!dirty) {
      removeStoredProfileDraft(identity.pubkey);
      return;
    }
    writeStoredProfileDraft(identity.pubkey, draft);
  }, [draft, dirty, identity?.pubkey]);

  const updateField = useCallback((key: keyof NostrProfile, value: string) => {
    setDirty(true);
    setStatus("idle");
    setError(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveProfile = useCallback(async () => {
    if (!identity) return;
    setStatus("saving");
    setError(null);
    try {
      const unsigned: any = {
        kind: 0,
        pubkey: identity.pubkey,
        created_at: nowSec(),
        tags: [],
        content: serializeProfileContent(draft)
      };
      const signed = await signEvent(unsigned);
      const published = await publishEventDetailed(relays, signed);
      setReport(published);
      if (!published.ok) {
        setStatus("error");
        setError("Profile publish failed on configured relays.");
        return;
      }
      setStatus("saved");
      setDirty(false);
      removeStoredProfileDraft(identity.pubkey);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message ?? "Failed to publish profile.");
    }
  }, [draft, identity, relays, signEvent]);

  const resetDraft = useCallback(() => {
    if (!identity?.pubkey) return;
    removeStoredProfileDraft(identity.pubkey);
    setDraft(toDraft(profileRecord?.profile));
    setDirty(false);
    setStatus("idle");
    setError(null);
  }, [identity?.pubkey, profileRecord?.profile]);

  if (!identity) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        Connect an identity to edit and publish profile metadata.
      </div>
    );
  }

  const npub = pubkeyHexToNpub(identity.pubkey);
  const publicProfileHref = `/profile/${npub ?? identity.pubkey}`;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">Identity Profile</div>
          <div className="text-sm text-neutral-300">Publish name, bio, avatar, and metadata (Nostr kind 0).</div>
        </div>
        <Link href={publicProfileHref} className="text-xs text-neutral-300 hover:text-white">
          Open public profile
        </Link>
      </div>

      <div className="text-[11px] text-neutral-500">
        Active: <span className="font-mono text-neutral-400">{shortenText(npub ?? identity.pubkey, { head: 22, tail: 10 })}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Name</div>
          <input
            value={draft.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="alice"
          />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Display Name</div>
          <input
            value={draft.displayName}
            onChange={(event) => updateField("displayName", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="Alice"
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <div className="text-xs text-neutral-500">Bio / About</div>
        <textarea
          value={draft.about}
          onChange={(event) => updateField("about", event.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm min-h-24"
          placeholder="What are you streaming?"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Avatar URL</div>
          <input
            value={draft.picture}
            onChange={(event) => updateField("picture", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="https://…"
          />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Banner URL</div>
          <input
            value={draft.banner}
            onChange={(event) => updateField("banner", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="https://…"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Website</div>
          <input
            value={draft.website}
            onChange={(event) => updateField("website", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="https://example.com"
          />
        </label>
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">NIP-05</div>
          <input
            value={draft.nip05}
            onChange={(event) => updateField("nip05", event.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
            placeholder="alice@example.com"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void saveProfile()}
          disabled={status === "saving"}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-60"
        >
          {status === "saving" ? "Publishing…" : "Save Profile"}
        </button>
        <button
          type="button"
          onClick={resetDraft}
          className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
        >
          Reset Draft
        </button>
      </div>

      {status === "saved" && <div className="text-xs text-emerald-300">Profile published successfully.</div>}
      {error && <div className="text-xs text-red-300">{error}</div>}
      {report && (
        <div className="text-[11px] text-neutral-500">
          Relay ack: {report.okRelays.length}/{report.okRelays.length + report.failedRelays.length}
        </div>
      )}
      {dirty && status !== "saving" && <div className="text-[11px] text-amber-300">Unsaved local profile draft.</div>}
    </div>
  );
}
