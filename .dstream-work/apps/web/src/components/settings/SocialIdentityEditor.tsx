"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, ExternalLink, RotateCcw, Save, Share2 } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrSocialIdentities } from "@/hooks/useNostrSocialIdentities";
import { getNostrRelays } from "@/lib/config";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import {
  NIP39_KIND,
  NIP39_PLATFORM_DEFINITIONS,
  emptyNip39Draft,
  mergeNip39Tags,
  nip39DraftFromRecord,
  nip39VerificationText,
  normalizeNip39Identity,
  normalizeNip39Proof,
  type Nip39Draft,
  type Nip39Platform
} from "@/lib/socialIdentities";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function SocialIdentityEditor() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const record = useNostrSocialIdentities(identity?.pubkey);
  const [draft, setDraft] = useState<Nip39Draft>(() => emptyNip39Draft());
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishEventReport | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const ownerRef = useRef("");
  const hydratedSourceRef = useRef("");

  const pubkey = identity?.pubkey ?? "";
  const sourceKey = `${pubkey}:${record?.createdAt ?? 0}`;

  useEffect(() => {
    if (ownerRef.current === pubkey) return;
    ownerRef.current = pubkey;
    hydratedSourceRef.current = "";
    setDraft(emptyNip39Draft());
    setDirty(false);
    setStatus("idle");
    setError(null);
    setReport(null);
    setCopyState("idle");
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || dirty || hydratedSourceRef.current === sourceKey) return;
    hydratedSourceRef.current = sourceKey;
    setDraft(nip39DraftFromRecord(record));
  }, [dirty, pubkey, record, sourceKey]);

  const updateField = useCallback((platform: Nip39Platform, field: "identity" | "proof", value: string) => {
    setDraft((current) => ({
      ...current,
      [platform]: { ...current[platform], [field]: value }
    }));
    setDirty(true);
    setStatus("idle");
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!identity) return;

    for (const definition of NIP39_PLATFORM_DEFINITIONS) {
      const row = draft[definition.platform];
      const hasIdentity = !!row.identity.trim();
      const hasProof = !!row.proof.trim();
      if (hasIdentity !== hasProof) {
        setStatus("error");
        setError(`${definition.label} needs both an account and a proof.`);
        return;
      }
      if (hasIdentity && !normalizeNip39Identity(definition.platform, row.identity)) {
        setStatus("error");
        setError(`${definition.label} account format is not valid.`);
        return;
      }
      if (hasProof && !normalizeNip39Proof(definition.platform, row.proof)) {
        setStatus("error");
        setError(`${definition.label} proof format is not valid.`);
        return;
      }
    }

    setStatus("saving");
    setError(null);
    try {
      const unsigned: any = {
        kind: NIP39_KIND,
        pubkey: identity.pubkey,
        created_at: nowSec(),
        tags: mergeNip39Tags(record?.tags ?? [], draft),
        content: record?.content ?? ""
      };
      const signed = await signEvent(unsigned);
      const published = await publishEventDetailed(relays, signed);
      setReport(published);
      if (!published.ok) {
        setStatus("error");
        setError("Social identity publish failed on configured relays.");
        return;
      }
      hydratedSourceRef.current = sourceKey;
      setStatus("saved");
      setDirty(false);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message ?? "Failed to publish social identities.");
    }
  }, [draft, identity, record, relays, signEvent, sourceKey]);

  const reset = useCallback(() => {
    hydratedSourceRef.current = sourceKey;
    setDraft(nip39DraftFromRecord(record));
    setDirty(false);
    setStatus("idle");
    setError(null);
  }, [record, sourceKey]);

  const copyProofText = useCallback(async () => {
    const npub = identity ? pubkeyHexToNpub(identity.pubkey) : null;
    if (!npub) return;
    try {
      await navigator.clipboard.writeText(nip39VerificationText(npub));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [identity]);

  if (!identity) return null;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-300"><Share2 className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Social identity proofs</h2>
            <p className="mt-1 text-xs text-neutral-500">NIP-39 account claims. Each proof should be a public post containing your Nostr public key.</p>
          </div>
        </div>
        <button type="button" onClick={() => void copyProofText()} className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800">
          <Clipboard className="h-3.5 w-3.5" /> {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy proof text"}
        </button>
      </div>

      <div className="divide-y divide-neutral-800 border-y border-neutral-800">
        {NIP39_PLATFORM_DEFINITIONS.map((definition) => (
          <div key={definition.platform} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <div className="text-xs font-medium text-neutral-300">{definition.label}</div>
            <input
              value={draft[definition.platform].identity}
              onChange={(event) => updateField(definition.platform, "identity", event.target.value)}
              className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder={definition.identityPlaceholder}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <input
              value={draft[definition.platform].proof}
              onChange={(event) => updateField(definition.platform, "proof", event.target.value)}
              className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder={definition.proofPlaceholder}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-xs">
          {status === "saved" ? <span className="text-emerald-300">Social identity proofs published.</span> : null}
          {error ? <span className="text-red-300">{error}</span> : null}
          {dirty && status !== "saving" && !error ? <span className="text-amber-300">You have unpublished proof changes.</span> : null}
          {!dirty && status === "idle" ? <a href="https://github.com/nostr-protocol/nips/blob/master/39.md" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-300">NIP-39 format <ExternalLink className="h-3 w-3" /></a> : null}
          {report ? <span className="ml-2 text-neutral-600">Relay confirmation {report.okRelays.length}/{report.okRelays.length + report.failedRelays.length}</span> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={reset} disabled={!dirty || status === "saving"} className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Reset</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || status === "saving"} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"><Save className="h-4 w-4" /> {status === "saving" ? "Publishing…" : "Publish proofs"}</button>
        </div>
      </div>
    </section>
  );
}
