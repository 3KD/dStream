"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { serializeProfileContent, type NostrProfile } from "@/lib/profile";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { shortenText } from "@/lib/encoding";

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

export default function ProfilePage() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const profileRecord = useNostrProfile(identity?.pubkey);
  const [draft, setDraft] = useState<Required<NostrProfile>>(toDraft(null));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishEventReport | null>(null);

  useEffect(() => {
    if (!identity) {
      setDraft(toDraft(null));
      setDirty(false);
      return;
    }
    if (dirty) return;
    setDraft(toDraft(profileRecord?.profile));
  }, [dirty, identity, profileRecord?.profile]);

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
      setDirty(false);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message ?? "Failed to publish profile.");
    }
  }, [draft, identity, relays, signEvent]);

  const npub = identity ? pubkeyHexToNpub(identity.pubkey) : null;
  const publicProfileHref = identity ? `/profile/${npub ?? identity.pubkey}` : null;

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
          </>
        )}
      </main>
    </div>
  );
}
