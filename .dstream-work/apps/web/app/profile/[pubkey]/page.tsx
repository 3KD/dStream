"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Filter } from "nostr-tools";
import { parseStreamAnnounceEvent, makeStreamKey, type StreamAnnounce } from "@dstream/protocol";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useSocial } from "@/context/SocialContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { pubkeyHexToNpub, pubkeyParamToHex } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

export default function PublicProfilePage() {
  const params = useParams<Record<string, string | string[]>>();
  const social = useSocial();
  const relays = useMemo(() => getNostrRelays(), []);

  const pubkeyParamRaw = params?.pubkey;
  const pubkeyParam = typeof pubkeyParamRaw === "string" ? pubkeyParamRaw : Array.isArray(pubkeyParamRaw) ? pubkeyParamRaw[0] ?? "" : "";
  const pubkey = useMemo(() => pubkeyParamToHex(pubkeyParam), [pubkeyParam]);
  const npub = pubkey ? pubkeyHexToNpub(pubkey) : null;
  const profileRecord = useNostrProfile(pubkey);

  const [streams, setStreams] = useState<StreamAnnounce[]>([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);

  useEffect(() => {
    if (!pubkey || !isHex64(pubkey)) {
      setStreams([]);
      return;
    }
    setStreams([]);
    setIsLoadingStreams(true);

    const filter: Filter = {
      kinds: [30311],
      authors: [pubkey],
      since: Math.floor(Date.now() / 1000) - 30 * 24 * 3600,
      limit: 80
    };

    const seen = new Map<string, number>();
    const sub = subscribeMany(relays, [filter], {
      onevent: (event: any) => {
        const parsed = parseStreamAnnounceEvent(event);
        if (!parsed) return;
        if (parsed.pubkey !== pubkey) return;
        const key = makeStreamKey(parsed.pubkey, parsed.streamId);
        const prevTs = seen.get(key);
        if (prevTs && prevTs >= parsed.createdAt) return;
        seen.set(key, parsed.createdAt);
        setStreams((prev) => {
          const map = new Map<string, StreamAnnounce>();
          for (const item of prev) map.set(makeStreamKey(item.pubkey, item.streamId), item);
          map.set(key, parsed);
          return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
        });
      },
      oneose: () => setIsLoadingStreams(false)
    });

    const timeout = setTimeout(() => setIsLoadingStreams(false), 5000);
    return () => {
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [pubkey, relays]);

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
                <h2 className="text-sm font-semibold text-neutral-200">Recent Streams</h2>
                <Link href="/browse" className="text-xs text-neutral-400 hover:text-white">
                  Browse
                </Link>
              </div>

              {isLoadingStreams ? (
                <div className="text-sm text-neutral-500">Loading streams…</div>
              ) : streams.length === 0 ? (
                <div className="text-sm text-neutral-500">No recent announces on configured relays.</div>
              ) : (
                <div className="space-y-2">
                  {streams.map((stream) => (
                    <div key={`${stream.pubkey}:${stream.streamId}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-200 truncate">{stream.title || stream.streamId}</div>
                        <div className="text-xs text-neutral-500">
                          {stream.status.toUpperCase()} · {new Date(stream.createdAt * 1000).toLocaleString()}
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
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
