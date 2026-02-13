"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Play, Plus, Save, Star, Users } from "lucide-react";
import {
  buildGuildEvent,
  buildGuildMembershipEvent,
  buildGuildRoleEvent,
  makeStreamKey,
  type GuildFeaturedStreamRef,
  type GuildMembershipStatus,
  type GuildRole
} from "@dstream/protocol";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useGuild } from "@/hooks/useGuild";
import { useGuildRoster } from "@/hooks/useGuildRoster";
import { useStreamAnnouncesForRefs } from "@/hooks/useStreamAnnouncesForRefs";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { getNostrRelays } from "@/lib/config";
import { publishEvent } from "@/lib/publish";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseTopics(raw: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function GuildDetailPage() {
  const router = useRouter();
  const routeParams = useParams<Record<string, string | string[]>>();
  const pubkeyParamRaw = routeParams?.pubkey;
  const guildIdRaw = routeParams?.guildId;
  const pubkeyParam = typeof pubkeyParamRaw === "string" ? pubkeyParamRaw : Array.isArray(pubkeyParamRaw) ? pubkeyParamRaw[0] ?? "" : "";
  const guildIdParam = typeof guildIdRaw === "string" ? guildIdRaw : Array.isArray(guildIdRaw) ? guildIdRaw[0] ?? "" : "";

  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);

  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const guildId = useMemo(() => decodeParam(guildIdParam).trim(), [guildIdParam]);
  const npub = useMemo(() => (pubkey ? pubkeyHexToNpub(pubkey) : null), [pubkey]);

  const { guild, isLoading } = useGuild({ pubkey: pubkey ?? "", guildId });
  const { members, isLoading: rosterLoading, viewerMembershipStatus } = useGuildRoster({
    guildPubkey: pubkey ?? "",
    guildId,
    viewerPubkey: identity?.pubkey
  });

  const isOwner = !!(identity && pubkey && identity.pubkey === pubkey);
  const viewerIsJoined = isOwner || viewerMembershipStatus === "joined";

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [image, setImage] = useState("");
  const [topicsRaw, setTopicsRaw] = useState("");
  const [featured, setFeatured] = useState<GuildFeaturedStreamRef[]>([]);
  const [featurePubkey, setFeaturePubkey] = useState("");
  const [featureStreamId, setFeatureStreamId] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "publishing" | "ok" | "fail">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [roleBusyByPubkey, setRoleBusyByPubkey] = useState<Record<string, boolean>>({});
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    if (!guild) return;
    setName(guild.name);
    setAbout(guild.about ?? "");
    setImage(guild.image ?? "");
    setTopicsRaw(guild.topics.join(", "));
    setFeatured(guild.featuredStreams);
  }, [guild?.createdAt]);

  const addFeatured = useCallback(() => {
    setSaveError(null);
    const pk = pubkeyParamToHex(featurePubkey);
    const sid = decodeParam(featureStreamId).trim();
    if (!pk) {
      setSaveError("Featured pubkey must be an `npub…` or 64-hex pubkey.");
      return;
    }
    if (!sid) {
      setSaveError("Featured stream id must be non-empty.");
      return;
    }
    setFeatured((prev) => {
      const exists = prev.some((r) => r.streamPubkey === pk && r.streamId === sid);
      return exists ? prev : [...prev, { streamPubkey: pk, streamId: sid }];
    });
    setFeaturePubkey("");
    setFeatureStreamId("");
  }, [featurePubkey, featureStreamId]);

  const removeFeatured = useCallback((ref: GuildFeaturedStreamRef) => {
    setFeatured((prev) => prev.filter((r) => !(r.streamPubkey === ref.streamPubkey && r.streamId === ref.streamId)));
  }, []);

  const publishMembership = useCallback(
    async (status: GuildMembershipStatus) => {
      if (!identity || !pubkey || !guildId) return;
      setMembershipError(null);
      setMembershipBusy(true);
      try {
        const unsigned = buildGuildMembershipEvent({
          pubkey: identity.pubkey,
          createdAt: nowSec(),
          guildPubkey: pubkey,
          guildId,
          status
        });
        const signed = await signEvent(unsigned as any);
        const ok = await publishEvent(relays, signed as any);
        if (!ok) throw new Error("Failed to publish membership update.");
      } catch (e: any) {
        setMembershipError(e?.message ?? "Failed to publish membership update.");
      } finally {
        setMembershipBusy(false);
      }
    },
    [guildId, identity, pubkey, relays, signEvent]
  );

  const setMemberRole = useCallback(
    async (targetPubkey: string, role: GuildRole) => {
      if (!identity || !pubkey || !guildId || !isOwner) return;
      setRoleError(null);
      setRoleBusyByPubkey((prev) => ({ ...prev, [targetPubkey]: true }));
      try {
        const unsigned = buildGuildRoleEvent({
          pubkey: identity.pubkey,
          createdAt: nowSec(),
          guildPubkey: pubkey,
          guildId,
          targetPubkey,
          role
        });
        const signed = await signEvent(unsigned as any);
        const ok = await publishEvent(relays, signed as any);
        if (!ok) throw new Error("Failed to publish guild role update.");
      } catch (e: any) {
        setRoleError(e?.message ?? "Failed to publish guild role update.");
      } finally {
        setRoleBusyByPubkey((prev) => ({ ...prev, [targetPubkey]: false }));
      }
    },
    [guildId, identity, isOwner, pubkey, relays, signEvent]
  );

  const saveGuild = useCallback(async () => {
    if (!identity || !pubkey) return;
    setSaveError(null);
    setSaveStatus("idle");

    const nm = name.trim();
    if (!nm) {
      setSaveError("Name is required.");
      return;
    }
    if (!guildId) {
      setSaveError("Guild id is missing.");
      return;
    }

    setSaveStatus("publishing");
    try {
      const unsigned = buildGuildEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        guildId,
        name: nm,
        about: about.trim() || undefined,
        image: image.trim() || undefined,
        topics: parseTopics(topicsRaw),
        featuredStreams: featured
      });
      const signed = await signEvent(unsigned as any);
      const ok = await publishEvent(relays, signed as any);
      setSaveStatus(ok ? "ok" : "fail");
      if (!ok) {
        setSaveError("Failed to publish guild to relays.");
        return;
      }
      setEditOpen(false);
    } catch (e: any) {
      setSaveStatus("fail");
      setSaveError(e?.message ?? "Failed to save guild.");
    }
  }, [about, featured, guildId, identity, image, name, relays, pubkey, signEvent, topicsRaw]);

  const visibleRefs = useMemo(() => {
    if (!guild) return [];
    return guild.featuredStreams.filter((r) => !social.isBlocked(r.streamPubkey));
  }, [guild, social]);

  const { streamsByKey, isLoading: streamsLoading } = useStreamAnnouncesForRefs(visibleRefs, { maxStreams: 120 });

  const featuredRows = useMemo(() => {
    const rows = visibleRefs.map((ref) => {
      const key = makeStreamKey(ref.streamPubkey, ref.streamId);
      const announce = streamsByKey[key];
      return { ref, key, announce };
    });

    rows.sort((a, b) => {
      const aLive = a.announce?.status === "live";
      const bLive = b.announce?.status === "live";
      if (aLive !== bLive) return aLive ? -1 : 1;
      return (b.announce?.createdAt ?? 0) - (a.announce?.createdAt ?? 0);
    });

    return rows;
  }, [streamsByKey, visibleRefs]);

  const ownerLabel = useMemo(() => {
    if (!pubkey) return null;
    const alias = social.getAlias(pubkey);
    if (alias) return alias;
    return npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(pubkey, { head: 14, tail: 8 });
  }, [npub, pubkey, social]);

  const homeRight = useMemo(() => {
    return (
      <Link className="text-sm text-neutral-300 hover:text-white" href="/guilds">
        <ArrowLeft className="w-4 h-4 inline-block -translate-y-px mr-2" />
        Guilds
      </Link>
    );
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader rightSlot={homeRight} />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {!pubkey || !guildId ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-neutral-300">
            Invalid guild URL. Expected `/guilds/:npubOrHex/:guildId`.
          </div>
        ) : isLoading ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4 animate-pulse">
            <div className="h-8 w-64 bg-neutral-800 rounded" />
            <div className="h-4 w-80 bg-neutral-800 rounded" />
            <div className="h-36 bg-neutral-900 rounded-2xl border border-neutral-800" />
          </div>
        ) : !guild ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-neutral-300 text-center space-y-3">
            <div className="text-lg font-semibold">Guild not found</div>
            <div className="text-sm text-neutral-500">No kind 30315 event was found for this author + d-tag on your configured relays.</div>
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
              onClick={() => router.push("/guilds")}
            >
              Back to guilds
            </button>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
              <div className="p-6 flex flex-col md:flex-row md:items-start gap-6">
                <div className="w-20 h-20 rounded-2xl bg-neutral-900 border border-neutral-800 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {guild.image ? <img src={guild.image} alt={guild.name} className="w-full h-full object-cover" /> : <Users className="w-8 h-8 text-neutral-600" />}
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h1 className="text-2xl font-bold truncate">{guild.name}</h1>
                      <div className="text-xs text-neutral-500 font-mono">
                        by <span className="text-neutral-300">{ownerLabel}</span> · <span className="text-neutral-600">{guild.guildId}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/browse?guild=${encodeURIComponent(pubkeyParam)}:${encodeURIComponent(guild.guildId)}`}
                        className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Browse curated
                      </Link>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setEditOpen((v) => !v)}
                          className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold"
                        >
                          {editOpen ? "Close" : "Edit"}
                        </button>
                      )}
                      {identity && !isOwner && (
                        <button
                          type="button"
                          onClick={() => void publishMembership(viewerIsJoined ? "left" : "joined")}
                          disabled={membershipBusy}
                          className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm text-neutral-200 disabled:opacity-50"
                        >
                          {membershipBusy ? "Publishing…" : viewerIsJoined ? "Leave guild" : "Join guild"}
                        </button>
                      )}
                    </div>
                  </div>

                  {guild.about && <div className="text-sm text-neutral-300 whitespace-pre-wrap">{guild.about}</div>}

                  <div className="text-xs text-neutral-500">
                    {members.length} member{members.length === 1 ? "" : "s"}
                    {!identity ? " · Connect identity to join" : ""}
                  </div>

                  {membershipError && <div className="text-xs text-red-300">{membershipError}</div>}

                  {guild.topics.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {guild.topics.map((t) => (
                        <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {editOpen && isOwner && (
              <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
                <div className="text-sm font-semibold text-neutral-200">Edit guild</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      placeholder="Builders Guild"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Guild ID (d-tag)</label>
                    <input
                      value={guild.guildId}
                      readOnly
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-sm font-mono text-neutral-400 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">About</label>
                  <textarea
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none min-h-20"
                    placeholder="What is this guild curating?"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Image URL (optional)</label>
                    <input
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                      placeholder="https://…"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Topics (comma-separated)</label>
                    <input
                      value={topicsRaw}
                      onChange={(e) => setTopicsRaw(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      placeholder="nostr, p2p, monero"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-4 space-y-3">
                  <div className="text-sm font-semibold text-neutral-200">Featured streams</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      value={featurePubkey}
                      onChange={(e) => setFeaturePubkey(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                      placeholder="creator npub… or hex"
                    />
                    <div className="flex gap-2">
                      <input
                        value={featureStreamId}
                        onChange={(e) => setFeatureStreamId(e.target.value)}
                        className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                        placeholder="streamId"
                      />
                      <button
                        type="button"
                        onClick={addFeatured}
                        className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                  </div>

                  {featured.length > 0 && (
                    <div className="space-y-2">
                      {featured.map((r) => (
                        <div
                          key={`${r.streamPubkey}:${r.streamId}`}
                          className="flex items-center justify-between gap-3 text-xs bg-neutral-900/60 border border-neutral-800 rounded-xl px-3 py-2"
                        >
                          <span className="font-mono text-neutral-300 truncate">
                            {pubkeyHexToNpub(r.streamPubkey) ?? shortenText(r.streamPubkey, { head: 18, tail: 8 })} / {r.streamId}
                          </span>
                          <button type="button" onClick={() => removeFeatured(r)} className="text-neutral-400 hover:text-white">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {saveError && <div className="text-sm text-red-300">{saveError}</div>}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void saveGuild()}
                    disabled={saveStatus === "publishing"}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {saveStatus === "publishing" ? "Publishing…" : saveStatus === "ok" ? "Saved" : "Publish update"}
                  </button>
                  <div className="text-xs text-neutral-500">Publishes to: {relays.join(", ")}</div>
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <header className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold">Members</h2>
                <div className="text-xs text-neutral-500">{members.length} active</div>
              </header>

              {rosterLoading && members.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((index) => (
                    <div key={index} className="h-12 rounded-xl border border-neutral-800 bg-neutral-900 animate-pulse" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <div className="text-sm text-neutral-500">No active members yet.</div>
              ) : (
                <div className="space-y-2">
                  {members.map((member) => {
                    const memberNpub = pubkeyHexToNpub(member.pubkey);
                    const alias = social.getAlias(member.pubkey);
                    const memberLabel = memberNpub
                      ? shortenText(memberNpub, { head: 14, tail: 8 })
                      : shortenText(member.pubkey, { head: 14, tail: 8 });
                    const roleClass =
                      member.role === "admin"
                        ? "text-red-300 border-red-700/40 bg-red-950/30"
                        : member.role === "moderator"
                          ? "text-blue-300 border-blue-700/40 bg-blue-950/30"
                          : "text-neutral-300 border-neutral-700 bg-neutral-900/70";

                    return (
                      <div key={member.pubkey} className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2 flex flex-wrap items-center gap-2 justify-between">
                        <div className="min-w-0">
                          <div className="text-sm text-neutral-200 truncate">
                            {alias ? (
                              <>
                                <span>{alias}</span> <span className="text-neutral-600">({memberLabel})</span>
                              </>
                            ) : (
                              memberLabel
                            )}
                          </div>
                          <div className="text-[11px] text-neutral-500 font-mono">{member.pubkey}</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${roleClass}`}>{member.role}</span>
                          {isOwner && member.pubkey !== pubkey && (
                            <>
                              <button
                                type="button"
                                onClick={() => void setMemberRole(member.pubkey, "member")}
                                disabled={!!roleBusyByPubkey[member.pubkey]}
                                className="px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-900 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                              >
                                Member
                              </button>
                              <button
                                type="button"
                                onClick={() => void setMemberRole(member.pubkey, "moderator")}
                                disabled={!!roleBusyByPubkey[member.pubkey]}
                                className="px-2 py-1 rounded-lg border border-blue-800/50 bg-blue-950/30 text-[11px] text-blue-200 hover:bg-blue-900/40 disabled:opacity-50"
                              >
                                Moderator
                              </button>
                              <button
                                type="button"
                                onClick={() => void setMemberRole(member.pubkey, "admin")}
                                disabled={!!roleBusyByPubkey[member.pubkey]}
                                className="px-2 py-1 rounded-lg border border-red-800/50 bg-red-950/30 text-[11px] text-red-200 hover:bg-red-900/40 disabled:opacity-50"
                              >
                                Admin
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {roleError && <div className="text-xs text-red-300">{roleError}</div>}
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <header className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold">Featured streams</h2>
                <div className="text-xs text-neutral-500">{featuredRows.length} streams</div>
              </header>

              {streamsLoading && featuredRows.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="aspect-video bg-neutral-900 rounded-xl animate-pulse border border-neutral-800" />
                  ))}
                </div>
              ) : featuredRows.length === 0 ? (
                <div className="text-sm text-neutral-500 text-center py-10">No featured streams yet.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {featuredRows.map(({ ref, key, announce }) => {
                    const streamNpub = pubkeyHexToNpub(ref.streamPubkey);
                    const streamPubkeyParam = streamNpub ?? ref.streamPubkey;
                    const href = `/watch/${streamPubkeyParam}/${encodeURIComponent(ref.streamId)}`;
                    const alias = social.getAlias(ref.streamPubkey);
                    const pubkeyLabel = streamNpub
                      ? shortenText(streamNpub, { head: 14, tail: 8 })
                      : shortenText(ref.streamPubkey, { head: 14, tail: 8 });
                    const favorite = social.isFavoriteCreator(ref.streamPubkey) || social.isFavoriteStream(ref.streamPubkey, ref.streamId);

                    return (
                      <Link
                        href={href}
                        key={key}
                        className="group block bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-blue-500/50 transition"
                      >
                        <div className="aspect-video bg-neutral-800 flex items-center justify-center relative">
                          {announce?.image ? (
                            <img src={announce.image} alt={announce.title} className="w-full h-full object-cover" />
                          ) : (
                            <Play className="w-10 h-10 text-white/20 group-hover:text-white/50 transition" />
                          )}
                          {announce?.status === "live" ? (
                            <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                              Live
                            </div>
                          ) : (
                            <div className="absolute top-2 left-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                              Offline
                            </div>
                          )}
                          {announce?.stakeAmountAtomic && announce.stakeAmountAtomic !== "0" && (
                            <div className="absolute top-2 right-2 bg-neutral-950/70 border border-neutral-700 text-neutral-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded">
                              Stake
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-base line-clamp-1 min-w-0">{announce?.title || ref.streamId}</h3>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                social.toggleFavoriteStream(ref.streamPubkey, ref.streamId);
                              }}
                              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-950/40 hover:bg-neutral-950/70 border border-neutral-800 text-neutral-200"
                              title={favorite ? "Unfavorite" : "Favorite"}
                              aria-label={favorite ? "Unfavorite stream" : "Favorite stream"}
                            >
                              <Star className={`w-4 h-4 ${favorite ? "fill-yellow-400 text-yellow-400" : "text-neutral-400"}`} />
                            </button>
                          </div>
                          <p className="text-xs text-neutral-500 font-mono">
                            {alias ? (
                              <>
                                <span className="text-neutral-300">{alias}</span>{" "}
                                <span className="text-neutral-600">({pubkeyLabel})</span>
                              </>
                            ) : (
                              pubkeyLabel
                            )}
                          </p>
                          {!announce && <div className="text-[11px] text-neutral-500">No announce found for this ref on configured relays.</div>}
                        </div>
                      </Link>
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
