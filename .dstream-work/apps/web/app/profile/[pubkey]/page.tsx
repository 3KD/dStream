"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Ban, BadgeCheck, ExternalLink, Heart, MoreHorizontal, Radio, ShieldCheck, WalletCards } from "lucide-react";
import { UnifiedTipDialog } from "@/components/chat/UnifiedTipDialog";
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
  const [tipOpen, setTipOpen] = useState(false);

  useEffect(() => {
    setVisibleChannelCount(30);
  }, [pubkey]);

  const liveChannels = useMemo(() => channels.filter((channel) => channel.status === "live"), [channels]);
  const pastChannels = useMemo(() => channels.filter((channel) => channel.status !== "live"), [channels]);
  const visibleChannels = useMemo(() => pastChannels.slice(0, visibleChannelCount), [pastChannels, visibleChannelCount]);
  const profile = profileRecord?.profile;
  const displayName = profile?.displayName || profile?.name || "Unnamed streamer";
  const primaryLive = liveChannels[0] ?? null;
  const profileHasTips = !!(
    profile?.lud16 ||
    profile?.lud06 ||
    profile?.xmr ||
    profile?.btc ||
    profile?.eth ||
    profile?.trx ||
    profile?.sol ||
    profile?.xrp ||
    profile?.ada ||
    profile?.doge
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto px-4 py-5 sm:p-6 space-y-5 sm:space-y-6">
        {!pubkey ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300">
            Invalid profile key. Expected `npub…` or 64-hex pubkey.
          </div>
        ) : (
          <>
            <header className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
              <div className="relative h-36 bg-neutral-900 sm:h-44">
                {profile?.banner ? <Image src={profile.banner} alt={`${displayName} banner`} fill sizes="(min-width: 1024px) 976px, 100vw" unoptimized className="object-cover" /> : null}
              </div>
              <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <div className="relative -mt-10 h-20 w-20 overflow-hidden rounded-lg border-4 border-neutral-950 bg-neutral-800 sm:h-24 sm:w-24">
                      {profile?.picture ? <Image src={profile.picture} alt={`${displayName} avatar`} fill sizes="96px" unoptimized className="object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-neutral-300">{displayName.slice(0, 1).toUpperCase()}</div>}
                    </div>
                    <div className="mt-3">
                      <h1 className="truncate text-2xl font-bold text-white">{displayName}</h1>
                      <div className="mt-1 truncate font-mono text-xs text-neutral-600">{shortenText(npub ?? pubkey, { head: 20, tail: 10 })}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => social.toggleFavoriteCreator(pubkey)}
                      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${social.isFavoriteCreator(pubkey) ? "border border-blue-500/40 bg-blue-500/15 text-blue-200" : "bg-blue-600 text-white hover:bg-blue-500"}`}
                    >
                      <Heart className={`h-4 w-4 ${social.isFavoriteCreator(pubkey) ? "fill-current" : ""}`} />
                      {social.isFavoriteCreator(pubkey) ? "Following" : "Follow"}
                    </button>
                    {profileHasTips ? (
                      <button type="button" onClick={() => setTipOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800">
                        <WalletCards className="h-4 w-4" /> Tip
                      </button>
                    ) : null}
                    <details className="group relative">
                      <summary className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800" aria-label="More creator actions" title="More actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-2xl">
                        <button type="button" onClick={() => (social.isTrusted(pubkey) ? social.removeTrusted(pubkey) : social.addTrusted(pubkey))} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800">
                          <ShieldCheck className="h-4 w-4" /> {social.isTrusted(pubkey) ? "Remove trust" : "Mark as trusted"}
                        </button>
                        <button type="button" onClick={() => (social.isBlocked(pubkey) ? social.removeBlocked(pubkey) : social.addBlocked(pubkey))} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-red-300 hover:bg-red-950/40">
                          <Ban className="h-4 w-4" /> {social.isBlocked(pubkey) ? "Unblock creator" : "Block creator"}
                        </button>
                      </div>
                    </details>
                  </div>
                </div>

                {profile?.about ? <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-neutral-300">{profile.about}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                  {profile?.nip05 ? (
                    <span className={`inline-flex items-center gap-1.5 ${profileRecord?.nip05Verified === true ? "text-emerald-300" : "text-neutral-400"}`}>
                      {profileRecord?.nip05Verified === true ? <BadgeCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      {profile.nip05}
                      {profileRecord?.nip05Verified === false ? <span className="text-red-300">Not verified</span> : profileRecord?.nip05Verified === undefined ? <span className="text-neutral-600">Checking</span> : null}
                    </span>
                  ) : null}
                  {profile?.website ? (
                    <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200">
                      Website <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            </header>

            <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-red-400" />
                  <h2 className="text-sm font-semibold text-neutral-100">Live now</h2>
                </div>
                <span className="text-xs text-neutral-600">{liveChannels.length} live</span>
              </div>
              {channelsLoading && channels.length === 0 ? (
                <div className="text-sm text-neutral-500">Checking for live streams…</div>
              ) : liveChannels.length === 0 ? (
                <div className="py-3 text-sm text-neutral-500">This creator is not live right now.</div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {liveChannels.map((stream) => (
                    <Link key={`${stream.pubkey}:${stream.streamId}`} href={`/watch/${npub ?? pubkey}/${stream.streamId}`} className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/50 hover:border-neutral-700">
                      <div className="relative aspect-video bg-neutral-900">
                        {stream.image ? <Image src={stream.image} alt="" fill sizes="(min-width: 640px) 480px, 100vw" unoptimized className="object-cover" /> : <div className="flex h-full w-full items-center justify-center"><Radio className="h-7 w-7 text-neutral-700" /></div>}
                        <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-1 text-[10px] font-bold uppercase text-white">Live</span>
                      </div>
                      <div className="p-3">
                        <div className="truncate text-sm font-medium text-neutral-100 group-hover:text-white">{stream.title || "Live stream"}</div>
                        {stream.summary ? <div className="mt-1 line-clamp-2 text-xs text-neutral-500">{stream.summary}</div> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-neutral-100">Past broadcasts</h2>
                <span className="text-xs text-neutral-600">{pastChannels.length}</span>
              </div>
              {channelsLoading && channels.length === 0 ? (
                <div className="text-sm text-neutral-500">Loading broadcasts…</div>
              ) : pastChannels.length === 0 ? (
                <div className="py-3 text-sm text-neutral-500">No previous broadcasts yet.</div>
              ) : (
                <div className="divide-y divide-neutral-800">
                  {visibleChannels.map((stream) => (
                    <div key={`${stream.pubkey}:${stream.streamId}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-neutral-200">{stream.title || "Untitled broadcast"}</div>
                        <div className="mt-1 text-xs text-neutral-600">{new Date(stream.createdAt * 1000).toLocaleString()}{stream.discoverable ? "" : " · Private"}</div>
                      </div>
                      <Link href={`/watch/${npub ?? pubkey}/${stream.streamId}`} className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Open</Link>
                    </div>
                  ))}
                  {pastChannels.length > visibleChannels.length ? (
                    <button type="button" onClick={() => setVisibleChannelCount((prev) => prev + 30)} className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800">Show more</button>
                  ) : null}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-100">Guilds</h2>
                <div className="text-xs text-neutral-600">{guildRows.length}</div>
              </div>

              {guildsLoading ? (
                <div className="text-sm text-neutral-500">Loading guilds…</div>
              ) : guildRows.length === 0 ? (
                <div className="text-sm text-neutral-500">No guild memberships yet.</div>
              ) : (
                <div className="space-y-2">
                  {guildRows.map((row) => {
                    const guildNpub = pubkeyHexToNpub(row.guildPubkey);
                    const href = `/guilds/${guildNpub ?? row.guildPubkey}/${encodeURIComponent(row.guildId)}`;
                    return (
                      <div key={row.key} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 truncate">{row.guildName}</div>
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
            <UnifiedTipDialog
              open={tipOpen}
              streamPubkey={pubkey}
              streamId={primaryLive?.streamId ?? "profile"}
              broadcasterName={displayName}
              onClose={() => setTipOpen(false)}
            />
          </>
        )}
      </main>
    </div>
  );
}
