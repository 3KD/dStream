"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { useProfileChannels } from "@/hooks/useProfileChannels";
import { useProfileGuildStatuses, type ProfileGuildStatus } from "@/hooks/useProfileGuildStatuses";
import { getNostrRelays } from "@/lib/config";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { serializeProfileContent, type NostrProfile } from "@/lib/profile";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

const GUILD_STATUS_LABEL: Record<ProfileGuildStatus, string> = {
  owner: "Owner (originator)",
  admin: "Admin",
  member: "Member",
  guest_vip: "Guest/VIP"
};

const GUILD_STATUS_CLASS: Record<ProfileGuildStatus, string> = {
  owner: "text-blue-200 border-blue-500/40 bg-blue-950/30",
  admin: "text-red-200 border-red-500/40 bg-red-950/30",
  member: "text-neutral-200 border-neutral-700 bg-neutral-900/60",
  guest_vip: "text-amber-200 border-amber-500/40 bg-amber-950/30"
};

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

const PROFILE_DRAFTS_STORAGE_KEY = "dstream_profile_drafts_v1";

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

export default function ProfilePage() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const profileRecord = useNostrProfile(identity?.pubkey);
  const { channels, isLoading: channelsLoading } = useProfileChannels(identity?.pubkey, { lookbackDays: null, fetchLimit: 1500 });
  const { guildRows, isLoading: guildsLoading } = useProfileGuildStatuses(identity?.pubkey);
  const [draft, setDraft] = useState<Required<NostrProfile>>(toDraft(null));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishEventReport | null>(null);
  const [visibleChannelCount, setVisibleChannelCount] = useState(30);

  useEffect(() => {
    setVisibleChannelCount(30);
  }, [identity?.pubkey]);

  useEffect(() => {
    if (!identity?.pubkey) {
      setDraft(toDraft(null));
      setDirty(false);
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
        setError("Profile event failed to publish to configured relays.");
        return;
      }
      setStatus("saved");
      removeStoredProfileDraft(identity.pubkey);
      setDirty(false);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message ?? "Failed to publish profile.");
    }
  }, [draft, identity, relays, signEvent]);

  const npub = identity ? pubkeyHexToNpub(identity.pubkey) : null;
  const publicProfileHref = identity ? `/profile/${npub ?? identity.pubkey}` : null;
  const visibleChannels = useMemo(() => channels.slice(0, visibleChannelCount), [channels, visibleChannelCount]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Profile</h1>
            <p className="text-sm text-neutral-400">Nostr metadata (kind 0): edit locally and publish to relays.</p>
          </div>
          {publicProfileHref ? (
            <Link href={publicProfileHref} className="text-sm text-neutral-300 hover:text-white">
              Open Public Profile
            </Link>
          ) : (
            <Link href="/browse" className="text-sm text-neutral-300 hover:text-white">
              Browse
            </Link>
          )}
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Connect an identity to edit your profile.
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="text-xs text-neutral-500">
                Active identity: <span className="font-mono text-neutral-300">{shortenText(npub ?? identity.pubkey, { head: 24, tail: 12 })}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Name</div>
                  <input
                    value={draft.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="alice"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Display Name</div>
                  <input
                    value={draft.displayName}
                    onChange={(e) => updateField("displayName", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="Alice"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <div className="text-xs text-neutral-500">Bio / About</div>
                <textarea
                  value={draft.about}
                  onChange={(e) => updateField("about", e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm min-h-24"
                  placeholder="What are you streaming?"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Avatar URL</div>
                  <input
                    value={draft.picture}
                    onChange={(e) => updateField("picture", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="https://…"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Banner URL</div>
                  <input
                    value={draft.banner}
                    onChange={(e) => updateField("banner", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="https://…"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">Website URL</div>
                  <input
                    value={draft.website}
                    onChange={(e) => updateField("website", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="https://…"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-neutral-500">NIP-05</div>
                  <input
                    value={draft.nip05}
                    onChange={(e) => updateField("nip05", e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                    placeholder="name@example.com"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={status === "saving"}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
                >
                  {status === "saving" ? "Publishing…" : "Publish Profile"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removeStoredProfileDraft(identity.pubkey);
                    setDraft(toDraft(profileRecord?.profile));
                    setDirty(false);
                    setStatus("idle");
                    setError(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                >
                  Reset
                </button>
                <div className="text-xs text-neutral-500">
                  NIP-05:{" "}
                  {profileRecord?.profile.nip05 ? (
                    profileRecord.nip05Verified === true ? (
                      <span className="text-emerald-300">verified</span>
                    ) : profileRecord.nip05Verified === false ? (
                      <span className="text-red-300">unverified</span>
                    ) : (
                      <span className="text-neutral-400">checking…</span>
                    )
                  ) : (
                    <span className="text-neutral-400">none</span>
                  )}
                </div>
              </div>

              {error && <div className="text-sm text-red-300">{error}</div>}
              {status === "saved" && !error && (
                <div className="text-sm text-emerald-300">
                  Profile published{report ? ` (${report.okRelays.length}/${relays.length} relays acknowledged).` : "."}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
              <div className="h-28 bg-neutral-900 relative">
                {draft.banner ? <img src={draft.banner} alt="Banner" className="w-full h-full object-cover" /> : null}
              </div>
              <div className="px-5 pb-5">
                <div className="-mt-10 w-20 h-20 rounded-2xl border-4 border-neutral-950 bg-neutral-900 overflow-hidden">
                  {draft.picture ? <img src={draft.picture} alt="Avatar" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="mt-3">
                  <div className="text-xl font-semibold">{draft.displayName || draft.name || "Unnamed streamer"}</div>
                  <div className="text-xs text-neutral-500 font-mono">{npub ?? identity.pubkey}</div>
                </div>
                {draft.about && <p className="mt-3 text-sm text-neutral-300 whitespace-pre-wrap">{draft.about}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-400">
                  {draft.nip05 && <span>NIP-05: {draft.nip05}</span>}
                  {draft.website && (
                    <a href={draft.website} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">
                      Website
                    </a>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-200">My Channels</h2>
                <div className="text-xs text-neutral-500">{channels.length} listed</div>
              </div>

              {channelsLoading ? (
                <div className="text-sm text-neutral-500">Loading channels…</div>
              ) : channels.length === 0 ? (
                <div className="text-sm text-neutral-500">No channel announces found on configured relays.</div>
              ) : (
                <div className="space-y-2">
                  {visibleChannels.map((channel) => (
                    <div key={`${channel.pubkey}:${channel.streamId}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-200 truncate">{channel.title || channel.streamId}</div>
                        <div className="text-xs text-neutral-500">
                          {channel.status.toUpperCase()} · {channel.discoverable ? "DISCOVERABLE" : "PRIVATE"} ·{" "}
                          {new Date(channel.createdAt * 1000).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/watch/${npub ?? identity.pubkey}/${channel.streamId}`}
                          className="px-2.5 py-1 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-xs"
                        >
                          Watch
                        </Link>
                        <Link
                          href={`/broadcast?streamId=${encodeURIComponent(channel.streamId)}`}
                          className="px-2.5 py-1 rounded-lg border border-blue-700/50 bg-blue-950/30 hover:bg-blue-900/30 text-xs text-blue-100"
                        >
                          Go Live
                        </Link>
                      </div>
                    </div>
                  ))}
                  {channels.length > visibleChannels.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleChannelCount((prev) => prev + 30)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                    >
                      Show More ({channels.length - visibleChannels.length} remaining)
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-neutral-200">Guilds</h2>
                <div className="text-xs text-neutral-500">{guildRows.length} listed</div>
              </div>
              {guildsLoading ? (
                <div className="text-sm text-neutral-500">Loading guild roles…</div>
              ) : guildRows.length === 0 ? (
                <div className="text-sm text-neutral-500">No guild memberships or ownership found on configured relays.</div>
              ) : (
                <div className="space-y-2">
                  {guildRows.map((row) => {
                    const guildNpub = pubkeyHexToNpub(row.guildPubkey);
                    const href = `/guilds/${guildNpub ?? row.guildPubkey}/${encodeURIComponent(row.guildId)}`;
                    return (
                      <div key={row.key} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 truncate">{row.guildName}</div>
                          <div className="text-[11px] text-neutral-500 font-mono truncate">
                            {row.guildId} · {shortenText(guildNpub ?? row.guildPubkey, { head: 18, tail: 8 })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${GUILD_STATUS_CLASS[row.status]}`}>
                            {GUILD_STATUS_LABEL[row.status]}
                          </span>
                          <Link href={href} className="px-2.5 py-1 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-xs">
                            Open
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
