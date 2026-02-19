"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useSocial } from "@/context/SocialContext";
import { useProfileGuildStatuses, type ProfileGuildStatus } from "@/hooks/useProfileGuildStatuses";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { useProfileChannels } from "@/hooks/useProfileChannels";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

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

export default function PublicProfilePage() {
  const params = useParams<Record<string, string | string[]>>();
  const social = useSocial();

  const pubkeyParamRaw = params?.pubkey;
  const pubkeyParam = typeof pubkeyParamRaw === "string" ? pubkeyParamRaw : Array.isArray(pubkeyParamRaw) ? pubkeyParamRaw[0] ?? "" : "";
  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const npub = pubkey ? pubkeyHexToNpub(pubkey) : null;
  const profileRecord = useNostrProfile(pubkey);
  const { guildRows, isLoading: guildsLoading } = useProfileGuildStatuses(pubkey);
  const { channels, isLoading: channelsLoading } = useProfileChannels(pubkey, { lookbackDays: null, fetchLimit: 1500 });
  const [visibleChannelCount, setVisibleChannelCount] = useState(30);

  useEffect(() => {
    setVisibleChannelCount(30);
  }, [pubkey]);

  const visibleChannels = useMemo(() => channels.slice(0, visibleChannelCount), [channels, visibleChannelCount]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {!pubkey ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Invalid profile key. Expected `npub…` or 64-hex pubkey.
          </div>
        ) : (
          <>
            <header className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
              <div className="h-32 bg-neutral-900">{profileRecord?.profile.banner ? <img src={profileRecord.profile.banner} alt="Banner" className="w-full h-full object-cover" /> : null}</div>
              <div className="px-5 pb-5">
                <div className="-mt-10 w-20 h-20 rounded-2xl border-4 border-neutral-950 bg-neutral-900 overflow-hidden">
                  {profileRecord?.profile.picture ? <img src={profileRecord.profile.picture} alt="Avatar" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="mt-3">
                  <h1 className="text-2xl font-bold">{profileRecord?.profile.displayName || profileRecord?.profile.name || "Unnamed streamer"}</h1>
                  <div className="text-xs text-neutral-500 font-mono">{shortenText(npub ?? pubkey, { head: 24, tail: 12 })}</div>
                </div>
                {profileRecord?.profile.about && <p className="mt-3 text-sm text-neutral-300 whitespace-pre-wrap">{profileRecord.profile.about}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-400">
                  {profileRecord?.profile.nip05 && (
                    <span>
                      NIP-05: {profileRecord.profile.nip05}{" "}
                      {profileRecord.nip05Verified === true ? (
                        <span className="text-emerald-300">(verified)</span>
                      ) : profileRecord.nip05Verified === false ? (
                        <span className="text-red-300">(unverified)</span>
                      ) : (
                        <span className="text-neutral-500">(checking…)</span>
                      )}
                    </span>
                  )}
                  {profileRecord?.profile.website && (
                    <a href={profileRecord.profile.website} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">
                      Website
                    </a>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => social.toggleFavoriteCreator(pubkey)}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                  >
                    {social.isFavoriteCreator(pubkey) ? "Unfavorite Creator" : "Favorite Creator"}
                  </button>
                  <button
                    type="button"
                    onClick={() => (social.isTrusted(pubkey) ? social.removeTrusted(pubkey) : social.addTrusted(pubkey))}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                  >
                    {social.isTrusted(pubkey) ? "Untrust" : "Trust"}
                  </button>
                  <button
                    type="button"
                    onClick={() => (social.isBlocked(pubkey) ? social.removeBlocked(pubkey) : social.addBlocked(pubkey))}
                    className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs"
                  >
                    {social.isBlocked(pubkey) ? "Unblock" : "Block"}
                  </button>
                </div>
              </div>
            </header>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-200">Channels</h2>
                <Link href="/browse" className="text-xs text-neutral-400 hover:text-white">
                  Browse
                </Link>
              </div>

              {channelsLoading ? (
                <div className="text-sm text-neutral-500">Loading channels…</div>
              ) : channels.length === 0 ? (
                <div className="text-sm text-neutral-500">No channel announces found on configured relays.</div>
              ) : (
                <div className="space-y-2">
                  {visibleChannels.map((stream) => (
                    <div key={`${stream.pubkey}:${stream.streamId}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-200 truncate">{stream.title || stream.streamId}</div>
                        <div className="text-xs text-neutral-500">
                          {stream.status.toUpperCase()} · {stream.discoverable ? "DISCOVERABLE" : "PRIVATE"} ·{" "}
                          {new Date(stream.createdAt * 1000).toLocaleString()}
                        </div>
                      </div>
                      <Link
                        href={`/watch/${npub ?? pubkey}/${stream.streamId}`}
                        className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs w-fit"
                      >
                        Watch
                      </Link>
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
              <div className="flex items-center justify-between">
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
                          <Link href={href} className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs">
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
