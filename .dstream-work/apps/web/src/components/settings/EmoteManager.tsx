"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { getNostrRelays } from "@/lib/config";
import { subscribeMany } from "@/lib/nostr";
import { publishEventDetailed, type PublishEventReport } from "@/lib/publish";
import { NOSTR_KINDS } from "@dstream/protocol";
import { Trash2, PlusCircle } from "lucide-react";

interface DraftEmote {
  shortcode: string;
  url: string;
  tier: "free" | "subscriber";
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function EmoteManager() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  
  const [draftEmotes, setDraftEmotes] = useState<DraftEmote[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishEventReport | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load existing emotes
  useEffect(() => {
    if (!identity?.pubkey) {
      setDraftEmotes([]);
      setStatus("idle");
      return;
    }

    let mounted = true;
    setLoading(true);

    const sub = subscribeMany(
      relays,
      [{ kinds: [NOSTR_KINDS.CUSTOM_EMOJI], authors: [identity.pubkey], limit: 1 }],
      {
        onevent: (event: any) => {
          if (!mounted) return;
          const emojiTags = event.tags.filter((t: string[]) => t[0] === "emoji" && t.length >= 3);
          const parsed: DraftEmote[] = emojiTags.map((t: string[]) => ({
            shortcode: t[1] || "",
            url: t[2] || "",
            tier: t[4] === "subscriber" ? "subscriber" : "free"
          }));
          setDraftEmotes(parsed);
          setLoading(false);
        },
        oneose: () => {
          if (mounted) setLoading(false);
        }
      }
    );

    // Timeout loading state if nothing found
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      try {
        (sub as any).close?.();
      } catch {
        // ignore
      }
    };
  }, [identity?.pubkey, relays]);

  const addEmote = useCallback(() => {
    setDraftEmotes(prev => [...prev, { shortcode: "new", url: "", tier: "free" }]);
    setDirty(true);
    setStatus("idle");
  }, []);

  const removeEmote = useCallback((index: number) => {
    setDraftEmotes(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
    setStatus("idle");
  }, []);

  const updateEmote = useCallback((index: number, patch: Partial<DraftEmote>) => {
    setDraftEmotes(prev => prev.map((e, i) => i === index ? { ...e, ...patch } : e));
    setDirty(true);
    setStatus("idle");
  }, []);

  const saveEmotes = useCallback(async () => {
    if (!identity) return;
    setStatus("saving");
    setError(null);

    // Validate shortcodes
    const invalid = draftEmotes.find(e => !/^[a-zA-Z0-9_]+$/.test(e.shortcode));
    if (invalid) {
      setStatus("error");
      setError(`Invalid shortcode formatting "${invalid.shortcode}". Alphanumeric and underscores only.`);
      return;
    }

    try {
      const tags = draftEmotes.map(e => ["emoji", e.shortcode, e.url, "", e.tier]);
      
      const unsigned: any = {
        kind: NOSTR_KINDS.CUSTOM_EMOJI,
        pubkey: identity.pubkey,
        created_at: nowSec(),
        tags: tags,
        content: `Custom Emotes Pack for ${identity.pubkey}`
      };
      
      const signed = await signEvent(unsigned);
      const published = await publishEventDetailed(relays, signed);
      setReport(published);
      if (!published.ok) {
        setStatus("error");
        setError("Emote publish failed on configured relays.");
        return;
      }
      setStatus("saved");
      setDirty(false);
    } catch (err: any) {
      setStatus("error");
      setError(err?.message ?? "Failed to publish emotes.");
    }
  }, [draftEmotes, identity, relays, signEvent]);

  if (!identity) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        Connect an identity to configure custom emotes.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">Custom Emote Manager</div>
          <div className="text-sm text-neutral-300">Publish your custom emotes pack. Viewers can type <code>:shortcode:</code> to use them.</div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        {loading && draftEmotes.length === 0 ? (
          <div className="text-sm text-neutral-500">Loading emotes from network...</div>
        ) : (
          draftEmotes.map((emote, index) => (
            <div key={index} className="flex flex-col sm:flex-row items-center gap-3">
              <input
                value={emote.shortcode}
                onChange={(e) => updateEmote(index, { shortcode: e.target.value })}
                className="w-full sm:w-32 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                placeholder="shortcode"
              />
              <input
                value={emote.url}
                onChange={(e) => updateEmote(index, { url: e.target.value })}
                className="w-full flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                placeholder="https://... (image URL)"
              />
              <select
                value={emote.tier}
                onChange={(e) => updateEmote(index, { tier: e.target.value as "free" | "subscriber" })}
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:outline-none"
              >
                <option value="free">Free Tier</option>
                <option value="subscriber">Subscribers Only</option>
              </select>
              <button
                type="button"
                onClick={() => removeEmote(index)}
                className="p-2 text-neutral-500 hover:text-red-400"
                title="Remove Emote"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={addEmote}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
        >
          <PlusCircle className="w-4 h-4 text-emerald-400" />
          Add Emote
        </button>
      </div>

      <div className="flex flex-wrap gap-2 pt-4 border-t border-neutral-800/50">
        <button
          type="button"
          onClick={() => void saveEmotes()}
          disabled={status === "saving" || (!dirty && draftEmotes.length > 0)}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-60"
        >
          {status === "saving" ? "Publishing…" : "Publish Emotes Pack"}
        </button>
      </div>

      {status === "saved" && <div className="text-xs text-emerald-300">Emote pack published successfully.</div>}
      {error && <div className="text-xs text-red-300">{error}</div>}
      {report && (
        <div className="text-[11px] text-neutral-500">
          Relay ack: {report.okRelays.length}/{report.okRelays.length + report.failedRelays.length}
        </div>
      )}
      {dirty && status !== "saving" && <div className="text-[11px] text-amber-300">Unsaved emote modifications.</div>}
    </div>
  );
}
