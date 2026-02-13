"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, Plus, Search, Users } from "lucide-react";
import { buildGuildEvent, type Guild, type GuildFeaturedStreamRef } from "@dstream/protocol";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useGuilds } from "@/hooks/useGuilds";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import { getNostrRelays } from "@/lib/config";
import { publishEvent } from "@/lib/publish";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function slugify(input: string): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseTopics(raw: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const HIDDEN_GUILDS_STORAGE_KEY = "dstream_hidden_guilds_v1";

function makeGuildCanonicalKey(pubkey: string, guildId: string): string {
  return `${(pubkey ?? "").trim().toLowerCase()}:${(guildId ?? "").trim().toLowerCase()}`;
}

function makeGuildFingerprint(guild: Guild): string {
  const name = guild.name.trim().toLowerCase();
  const about = (guild.about ?? "").trim().toLowerCase();
  const image = (guild.image ?? "").trim().toLowerCase();
  const topics = guild.topics.map((topic) => topic.trim().toLowerCase()).sort((a, b) => a.localeCompare(b)).join("|");
  return `${guild.pubkey}:${name}:${about}:${image}:${topics}`;
}

export default function GuildsPage() {
  const router = useRouter();
  const social = useSocial();
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const { guilds, isLoading } = useGuilds({ limit: 80 });

  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [guildId, setGuildId] = useState("");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [image, setImage] = useState("");
  const [topicsRaw, setTopicsRaw] = useState("");
  const [featured, setFeatured] = useState<GuildFeaturedStreamRef[]>([]);
  const [featurePubkey, setFeaturePubkey] = useState("");
  const [featureStreamId, setFeatureStreamId] = useState("");
  const [createStatus, setCreateStatus] = useState<"idle" | "publishing" | "ok" | "fail">("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [hiddenGuildKeys, setHiddenGuildKeys] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_GUILDS_STORAGE_KEY);
      if (!raw) {
        setHiddenGuildKeys([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setHiddenGuildKeys([]);
        return;
      }
      const normalized = Array.from(
        new Set(parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));
      setHiddenGuildKeys(normalized);
    } catch {
      setHiddenGuildKeys([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_GUILDS_STORAGE_KEY, JSON.stringify(hiddenGuildKeys));
    } catch {
      // ignore
    }
  }, [hiddenGuildKeys]);

  const hiddenGuildSet = useMemo(() => new Set(hiddenGuildKeys), [hiddenGuildKeys]);

  const { visibleGuilds, duplicateCollapseCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const newestByCanonical = new Map<string, Guild>();
    for (const guild of guilds) {
      if (social.isBlocked(guild.pubkey)) continue;
      const canonicalKey = makeGuildCanonicalKey(guild.pubkey, guild.guildId);
      if (hiddenGuildSet.has(canonicalKey)) continue;
      const existing = newestByCanonical.get(canonicalKey);
      if (!existing || guild.createdAt > existing.createdAt) newestByCanonical.set(canonicalKey, guild);
    }

    const dedupedByFingerprint = new Map<string, Guild>();
    let duplicateCollapseCount = 0;
    for (const guild of newestByCanonical.values()) {
      const fingerprint = makeGuildFingerprint(guild);
      const existing = dedupedByFingerprint.get(fingerprint);
      if (!existing) {
        dedupedByFingerprint.set(fingerprint, guild);
        continue;
      }
      duplicateCollapseCount += 1;
      if (guild.createdAt > existing.createdAt) dedupedByFingerprint.set(fingerprint, guild);
    }

    let result = Array.from(dedupedByFingerprint.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (q) {
      result = result.filter((g) => {
        const topics = g.topics.join(" ").toLowerCase();
        return g.name.toLowerCase().includes(q) || (g.about ?? "").toLowerCase().includes(q) || topics.includes(q);
      });
    }

    return { visibleGuilds: result, duplicateCollapseCount };
  }, [guilds, hiddenGuildSet, search, social]);

  const hideGuild = useCallback((guild: Guild) => {
    const key = makeGuildCanonicalKey(guild.pubkey, guild.guildId);
    setHiddenGuildKeys((prev) => {
      if (prev.includes(key)) return prev;
      return [...prev, key].sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const clearHiddenGuilds = useCallback(() => {
    setHiddenGuildKeys([]);
  }, []);

  const addFeatured = useCallback(() => {
    setCreateError(null);
    const pk = pubkeyParamToHex(featurePubkey);
    const sid = featureStreamId.trim();
    if (!pk) {
      setCreateError("Featured pubkey must be an `npub…` or 64-hex pubkey.");
      return;
    }
    if (!sid) {
      setCreateError("Featured stream id must be non-empty.");
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

  const createGuild = useCallback(async () => {
    if (!identity) return;
    setCreateError(null);
    setCreateStatus("idle");

    const id = (guildId.trim() || slugify(name) || `guild-${Date.now()}`).slice(0, 64);
    const nm = name.trim();
    if (!nm) {
      setCreateError("Name is required.");
      return;
    }

    setCreateStatus("publishing");
    try {
      const unsigned = buildGuildEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        guildId: id,
        name: nm,
        about: about.trim() || undefined,
        image: image.trim() || undefined,
        topics: parseTopics(topicsRaw),
        featuredStreams: featured
      });
      const signed = await signEvent(unsigned as any);
      const ok = await publishEvent(relays, signed as any);
      setCreateStatus(ok ? "ok" : "fail");
      if (!ok) {
        setCreateError("Failed to publish guild to relays.");
        return;
      }
      const pubkeyParam = pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey;
      router.push(`/guilds/${pubkeyParam}/${encodeURIComponent(id)}`);
    } catch (e: any) {
      setCreateStatus("fail");
      setCreateError(e?.message ?? "Failed to create guild.");
    }
  }, [about, featured, guildId, identity, image, name, relays, router, signEvent, topicsRaw]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Users className="w-6 h-6 text-blue-500" />
              Guilds
            </h1>
            <p className="text-sm text-neutral-400">Curated discovery published on Nostr (kind 30315).</p>
          </div>
          <Link className="text-sm text-neutral-300 hover:text-white" href="/">
            Home
          </Link>
        </header>

        {identity && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-neutral-200">Create a guild</div>
              <button
                type="button"
                onClick={() => setCreateOpen((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {createOpen ? "Hide" : "New"}
              </button>
            </div>

            {createOpen && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Name</label>
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (!guildId.trim()) setGuildId(slugify(e.target.value));
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      placeholder="Builders Guild"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Guild ID (d-tag)</label>
                    <input
                      value={guildId}
                      onChange={(e) => setGuildId(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono"
                      placeholder="builders"
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
                  <div className="text-sm font-semibold text-neutral-200">Featured streams (optional)</div>
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
                        className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
                      >
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
                          <button
                            type="button"
                            onClick={() => removeFeatured(r)}
                            className="text-neutral-400 hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {createError && <div className="text-sm text-red-300">{createError}</div>}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void createGuild()}
                    disabled={createStatus === "publishing"}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold disabled:opacity-50"
                  >
                    {createStatus === "publishing" ? "Publishing…" : createStatus === "ok" ? "Published" : "Publish guild"}
                  </button>
                  <div className="text-xs text-neutral-500">Publishes to: {relays.join(", ")}</div>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search guilds by name, about, or topic…"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-neutral-500">
                {visibleGuilds.length} guilds
                {duplicateCollapseCount > 0 ? ` · ${duplicateCollapseCount} duplicates collapsed` : ""}
                {hiddenGuildKeys.length > 0 ? ` · ${hiddenGuildKeys.length} hidden` : ""}
              </div>
              {hiddenGuildKeys.length > 0 && (
                <button
                  type="button"
                  onClick={clearHiddenGuilds}
                  className="text-xs px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-neutral-300"
                >
                  Restore hidden
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-neutral-500">
            Guild events are relay records. “Hide” removes repeated entries from this device only.
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 bg-neutral-900 rounded-2xl animate-pulse border border-neutral-800" />
              ))}
            </div>
          ) : visibleGuilds.length === 0 ? (
            <div className="text-sm text-neutral-500 py-10 text-center">No guilds found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleGuilds.map((g) => {
                const npub = pubkeyHexToNpub(g.pubkey);
                const pubkeyParam = npub ?? g.pubkey;
                const alias = social.getAlias(g.pubkey);
                const byLabel = alias ?? (npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(g.pubkey, { head: 14, tail: 8 }));
                const href = `/guilds/${pubkeyParam}/${encodeURIComponent(g.guildId)}`;
                const canonicalKey = makeGuildCanonicalKey(g.pubkey, g.guildId);

                return (
                  <article
                    key={canonicalKey}
                    className="group rounded-2xl border border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/60 transition-colors overflow-hidden"
                  >
                    <Link href={href} className="block p-4 flex items-start gap-4">
                      <div className="w-14 h-14 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {g.image ? <img src={g.image} alt={g.name} className="w-full h-full object-cover" /> : <Users className="w-6 h-6 text-neutral-600" />}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-neutral-100 truncate">{g.name}</div>
                            <div className="text-xs text-neutral-500 font-mono truncate">
                              by {byLabel} · <span className="text-neutral-600">{g.guildId}</span>
                            </div>
                          </div>
                          <div className="text-xs text-neutral-500 flex-shrink-0">{g.featuredStreams.length} featured</div>
                        </div>
                        {g.about && <div className="text-sm text-neutral-400 line-clamp-2">{g.about}</div>}
                        {g.topics.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {g.topics.slice(0, 6).map((t) => (
                              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-300">
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                    <div className="px-4 pb-4 pt-1 flex items-center justify-between gap-3">
                      <Link href={href} className="text-xs text-blue-300 hover:text-blue-200">
                        Open guild
                      </Link>
                      <button
                        type="button"
                        onClick={() => hideGuild(g)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-neutral-300"
                        title="Hide this guild from this device"
                      >
                        <EyeOff className="w-3 h-3" />
                        Hide
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
