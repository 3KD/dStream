"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Globe2, Image as ImageIcon, Link2, RotateCcw, Save, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import { shortenText } from "@/lib/encoding";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { serializeProfileContent, type NostrProfile } from "@/lib/profile";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { isPublicPaymentAsset } from "@/lib/payments/publicAssets";

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
    nip05: profile?.nip05 ?? "",
    lud16: profile?.lud16 ?? "",
    lud06: profile?.lud06 ?? "",
    btc: profile?.btc ?? "",
    eth: profile?.eth ?? "",
    trx: profile?.trx ?? "",
    xmr: profile?.xmr ?? "",
    sol: profile?.sol ?? "",
    ada: profile?.ada ?? "",
    doge: profile?.doge ?? "",
    ltc: profile?.ltc ?? "",
    ton: profile?.ton ?? "",
    xrp: profile?.xrp ?? "",
    dot: profile?.dot ?? ""
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
  }, [identity, profileRecord?.profile]);

  if (!identity) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        Connect an identity to edit and publish profile metadata.
      </div>
    );
  }

  const npub = pubkeyHexToNpub(identity.pubkey);
  const publicProfileHref = `/profile/${npub ?? identity.pubkey}`;
  const previewName = draft.displayName.trim() || draft.name.trim() || "Your display name";
  const previewHandle = draft.name.trim() || "username";
  const previewInitial = previewName.slice(0, 1).toUpperCase() || "?";
  const paymentLabels = [
    draft.lud16.trim() ? "Lightning" : "",
    draft.btc.trim() ? "Bitcoin" : "",
    draft.xmr.trim() ? "Monero" : "",
    isPublicPaymentAsset("eth") && draft.eth.trim() ? "Ethereum" : "",
    isPublicPaymentAsset("trx") && draft.trx.trim() ? "TRON" : ""
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300"><UserRound className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Public identity</h2>
              <p className="mt-1 text-xs text-neutral-500">How viewers recognize you across dStream.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Username</span>
              <input value={draft.name} onChange={(event) => updateField("name", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="alice" />
              <span className="block text-[11px] text-neutral-600">A short, consistent handle.</span>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Display name</span>
              <input value={draft.displayName} onChange={(event) => updateField("displayName", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Alice" />
              <span className="block text-[11px] text-neutral-600">The name shown beside your streams.</span>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-neutral-400">About</span>
            <textarea value={draft.about} onChange={(event) => updateField("about", event.target.value)} className="min-h-28 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="Tell viewers what you create and stream." />
          </label>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300"><ImageIcon className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">Images and links</h2>
              <p className="mt-1 text-xs text-neutral-500">Use direct image URLs; the preview updates as you type.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Avatar image URL</span>
              <input value={draft.picture} onChange={(event) => updateField("picture", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="https://…" inputMode="url" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Banner image URL</span>
              <input value={draft.banner} onChange={(event) => updateField("banner", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="https://…" inputMode="url" />
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-neutral-400">Website</span>
            <div className="relative">
              <Globe2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-600" />
              <input value={draft.website} onChange={(event) => updateField("website", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none" placeholder="https://example.com" inputMode="url" />
            </div>
          </label>
          <details className="group border-t border-neutral-800 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-neutral-400 hover:text-neutral-200">
              Nostr identity details
              <ShieldCheck className="h-4 w-4" />
            </summary>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs text-neutral-400">Verified Nostr address</span>
                <input value={draft.nip05} onChange={(event) => updateField("nip05", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="alice@example.com" />
                <span className="block text-[11px] text-neutral-600">Also known as NIP-05. Verification is checked after publishing.</span>
              </label>
              <div className="text-[11px] text-neutral-600">Active identity: <span className="font-mono text-neutral-400">{shortenText(npub ?? identity.pubkey, { head: 22, tail: 10 })}</span></div>
            </div>
          </details>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300"><WalletCards className="h-4 w-4" /></span>
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">Tips and payments</h2>
                <p className="mt-1 text-xs text-neutral-500">Viewers can choose any destination you publish here.</p>
              </div>
            </div>
            <Link href="/settings/monetization" className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white">Payment services <ExternalLink className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Lightning address</span>
              <input value={draft.lud16} onChange={(event) => updateField("lud16", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none" placeholder="name@provider.com" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Bitcoin address</span>
              <input value={draft.btc} onChange={(event) => updateField("btc", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm font-mono focus:border-blue-500 focus:outline-none" placeholder="bc1q..." />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-neutral-400">Monero address</span>
              <input value={draft.xmr} onChange={(event) => updateField("xmr", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm font-mono focus:border-blue-500 focus:outline-none" placeholder="4..." />
            </label>
            {isPublicPaymentAsset("eth") ? (
              <label className="space-y-1.5">
                <span className="text-xs text-neutral-400">Ethereum address</span>
                <input value={draft.eth} onChange={(event) => updateField("eth", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm font-mono focus:border-blue-500 focus:outline-none" placeholder="0x..." />
              </label>
            ) : null}
            {isPublicPaymentAsset("trx") ? (
              <label className="space-y-1.5">
                <span className="text-xs text-neutral-400">TRON address</span>
                <input value={draft.trx} onChange={(event) => updateField("trx", event.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm font-mono focus:border-blue-500 focus:outline-none" placeholder="T..." />
              </label>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-xs">
            {status === "saved" ? <span className="text-emerald-300">Profile published successfully.</span> : null}
            {error ? <span className="text-red-300">{error}</span> : null}
            {dirty && status !== "saving" ? <span className="text-amber-300">You have unpublished changes.</span> : null}
            {!dirty && status === "idle" ? <span className="text-neutral-500">Your published profile is up to date.</span> : null}
            {report ? <span className="ml-2 text-neutral-600">Relay confirmation {report.okRelays.length}/{report.okRelays.length + report.failedRelays.length}</span> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={resetDraft} disabled={!dirty || status === "saving"} className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Reset</button>
            <button type="button" onClick={() => void saveProfile()} disabled={status === "saving" || !dirty} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"><Save className="h-4 w-4" /> {status === "saving" ? "Publishing…" : "Publish profile"}</button>
          </div>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div className="relative h-28 bg-neutral-900">
            {draft.banner.trim() ? <Image src={draft.banner.trim()} alt="Profile banner preview" fill sizes="320px" unoptimized className="object-cover" /> : <div className="absolute inset-0 bg-[linear-gradient(135deg,#171717,#0a0a0a)]" />}
          </div>
          <div className="px-4 pb-5">
            <div className="relative -mt-9 h-[72px] w-[72px] overflow-hidden rounded-lg border-4 border-neutral-950 bg-neutral-800">
              {draft.picture.trim() ? <Image src={draft.picture.trim()} alt="Profile avatar preview" fill sizes="72px" unoptimized className="object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-neutral-300">{previewInitial}</div>}
            </div>
            <div className="mt-3 min-w-0">
              <div className="truncate text-lg font-semibold text-white">{previewName}</div>
              <div className="truncate text-xs text-neutral-500">@{previewHandle}</div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{draft.about.trim() || "Your bio will appear here."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {draft.website.trim() ? <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300"><Link2 className="h-3 w-3" /> Website</span> : null}
              {draft.nip05.trim() ? <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300"><ShieldCheck className="h-3 w-3" /> {draft.nip05.trim()}</span> : null}
            </div>
            {paymentLabels.length > 0 ? (
              <div className="mt-4 border-t border-neutral-800 pt-4">
                <div className="text-[11px] uppercase tracking-wider text-neutral-600">Accepts tips</div>
                <div className="mt-2 flex flex-wrap gap-1.5">{paymentLabels.map((label) => <span key={label} className="rounded-md bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300">{label}</span>)}</div>
              </div>
            ) : null}
            <Link href={publicProfileHref} className="mt-5 inline-flex items-center gap-2 text-xs text-neutral-400 hover:text-white">Open public profile <ExternalLink className="h-3.5 w-3.5" /></Link>
          </div>
        </div>
        <p className="mt-3 px-1 text-[11px] leading-5 text-neutral-600">Preview only. Publish changes to update your profile on configured Nostr relays.</p>
      </aside>
    </div>
  );
}
