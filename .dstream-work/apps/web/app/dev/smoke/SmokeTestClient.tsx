"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildStreamAnnounceEvent,
  buildStreamChatEvent,
  makeATag,
  parseStreamAnnounceEvent,
  parseStreamChatEvent
} from "@dstream/protocol";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { useIdentity } from "@/context/IdentityContext";
import { subscribeMany } from "@/lib/nostr";
import { publishEvent } from "@/lib/publish";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";

type StepStatus = "pending" | "running" | "ok" | "fail";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function pillClass(status: StepStatus) {
  switch (status) {
    case "ok":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "fail":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "running":
      return "bg-blue-500/15 text-blue-300 border-blue-500/30";
    default:
      return "bg-neutral-800/60 text-neutral-300 border-neutral-700";
  }
}

export default function SmokeTestClient() {
  const { identity, generateLocal, signEvent } = useIdentity();
  const relays = useMemo(() => ["ws://localhost:8081"], []);

  const streamId = "test";
  const watchHref = identity ? `/watch/${pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey}/${streamId}` : `/watch/npub/${streamId}`;
  const hlsUrl = `/api/hls/${streamId}/index.m3u8`;

  const requestedIdentityRef = useRef(false);
  const ranRef = useRef(false);

  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hlsStep, setHlsStep] = useState<StepStatus>("pending");
  const [announceStep, setAnnounceStep] = useState<StepStatus>("pending");
  const [announceSeenStep, setAnnounceSeenStep] = useState<StepStatus>("pending");
  const [chatStep, setChatStep] = useState<StepStatus>("pending");
  const [chatSeenStep, setChatSeenStep] = useState<StepStatus>("pending");

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), line]);
  }, []);

  const waitForAnnounce = useCallback(
    async (pubkey: string) => {
      const start = nowSec();
      const filter = {
        kinds: [30311],
        authors: [pubkey],
        "#d": [streamId],
        since: start - 60,
        limit: 10
      };

      return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          resolve(ok);
        };

        const sub = subscribeMany(relays, [filter as any], {
          onevent: (event: any) => {
            const parsed = parseStreamAnnounceEvent(event);
            if (!parsed) return;
            if (parsed.pubkey !== pubkey || parsed.streamId !== streamId) return;
            finish(true);
            try {
              (sub as any).close?.();
            } catch {
              // ignore
            }
          },
          oneose: () => {
            // If it doesn't show up quickly, treat as not-seen (relay may be write-only / slow).
            setTimeout(() => finish(false), 600);
          }
        });

        setTimeout(() => {
          try {
            (sub as any).close?.();
          } catch {
            // ignore
          }
          finish(false);
        }, 2500);
      });
    },
    [relays]
  );

  const waitForChat = useCallback(
    async (streamPubkey: string) => {
      const start = nowSec();
      const aTag = makeATag(streamPubkey, streamId);
      const filter = {
        kinds: [1311],
        "#a": [aTag],
        since: start - 60,
        limit: 20
      };

      return await new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          resolve(ok);
        };

        const sub = subscribeMany(relays, [filter as any], {
          onevent: (event: any) => {
            const parsed = parseStreamChatEvent(event, { streamPubkey, streamId });
            if (!parsed) return;
            if (parsed.streamPubkey !== streamPubkey || parsed.streamId !== streamId) return;
            finish(true);
            try {
              (sub as any).close?.();
            } catch {
              // ignore
            }
          },
          oneose: () => {
            setTimeout(() => finish(false), 600);
          }
        });

        setTimeout(() => {
          try {
            (sub as any).close?.();
          } catch {
            // ignore
          }
          finish(false);
        }, 2500);
      });
    },
    [relays]
  );

  const run = useCallback(async () => {
    if (!identity) return;

    setError(null);
    setLog([]);

    setHlsStep("running");
    setAnnounceStep("running");
    setAnnounceSeenStep("running");
    setChatStep("running");
    setChatSeenStep("running");

    pushLog(`Using relay: ${relays.join(", ")}`);
    pushLog(`Stream ID: ${streamId}`);
    pushLog(`Pubkey: ${identity.pubkey}`);

    try {
      const res = await fetch(hlsUrl, { cache: "no-store" });
      pushLog(`HLS fetch: ${hlsUrl} -> ${res.status}`);
      setHlsStep(res.ok ? "ok" : "fail");
    } catch (e: any) {
      setHlsStep("fail");
      pushLog(`HLS fetch failed: ${e?.message ?? String(e)}`);
    }

    try {
      const unsigned: any = buildStreamAnnounceEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        streamId,
        title: "FFSIM Test Stream",
        status: "live",
        summary: "Auto-announced from /dev/smoke (local relay only).",
        streaming: `${window.location.origin}${hlsUrl}`,
        topics: ["smoke", "local"]
      });

      const signed = await signEvent(unsigned);
      const ok = await publishEvent(relays, signed);
      setAnnounceStep(ok ? "ok" : "fail");
      pushLog(`Announce publish: ${ok ? "ok" : "failed"}`);
    } catch (e: any) {
      setAnnounceStep("fail");
      pushLog(`Announce error: ${e?.message ?? String(e)}`);
    }

    try {
      const seen = await waitForAnnounce(identity.pubkey);
      setAnnounceSeenStep(seen ? "ok" : "fail");
      pushLog(`Announce seen via REQ: ${seen ? "ok" : "not observed"}`);
    } catch (e: any) {
      setAnnounceSeenStep("fail");
      pushLog(`Announce seen-check error: ${e?.message ?? String(e)}`);
    }

    try {
      const unsigned: any = buildStreamChatEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        streamPubkey: identity.pubkey,
        streamId,
        content: `hello from /dev/smoke @ ${new Date().toLocaleTimeString()}`
      });
      const signed = await signEvent(unsigned);
      const ok = await publishEvent(relays, signed);
      setChatStep(ok ? "ok" : "fail");
      pushLog(`Chat publish: ${ok ? "ok" : "failed"}`);
    } catch (e: any) {
      setChatStep("fail");
      pushLog(`Chat error: ${e?.message ?? String(e)}`);
    }

    try {
      const seen = await waitForChat(identity.pubkey);
      setChatSeenStep(seen ? "ok" : "fail");
      pushLog(`Chat seen via REQ: ${seen ? "ok" : "not observed"}`);
    } catch (e: any) {
      setChatSeenStep("fail");
      pushLog(`Chat seen-check error: ${e?.message ?? String(e)}`);
    }
  }, [hlsUrl, identity, pushLog, relays, signEvent, waitForAnnounce, waitForChat]);

  useEffect(() => {
    if (ranRef.current) return;
    if (!identity) {
      if (requestedIdentityRef.current) return;
      requestedIdentityRef.current = true;
      pushLog("No identity found; generating a local dev key…");
      void generateLocal().catch((e: any) => setError(e?.message ?? "Failed to generate local key."));
      return;
    }
    ranRef.current = true;
    void run();
  }, [generateLocal, identity, pushLog, run]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Dev Smoke Test</h1>
          <p className="text-sm text-neutral-300">
            Auto-generates a local dev identity, announces the existing docker test stream, and posts a chat message — against the local relay only.
          </p>
          <p className="text-xs text-neutral-500 font-mono">
            Route: <span className="text-neutral-300">/watch/:npub/:streamId</span>
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(hlsStep)}`}>HLS fetch</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(announceStep)}`}>Announce publish</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(announceSeenStep)}`}>Announce seen</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(chatStep)}`}>Chat publish</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(chatSeenStep)}`}>Chat seen</span>
          </div>

          <div className="text-sm text-neutral-300 space-y-2">
            <div>
              <span className="text-neutral-500">Relay:</span> <span className="font-mono">{relays.join(", ")}</span>
            </div>
            <div>
              <span className="text-neutral-500">Stream ID:</span> <span className="font-mono">{streamId}</span>
            </div>
            <div>
              <span className="text-neutral-500">HLS URL:</span> <span className="font-mono">{hlsUrl}</span>
            </div>
            <div>
              <span className="text-neutral-500">Pubkey:</span>{" "}
              <span className="font-mono break-all">{identity?.pubkey ?? "…"}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={watchHref}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold"
              title="Open watch page for /watch/:npub/:streamId"
            >
              Open Watch
            </Link>
            <Link href="/browse" className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm">
              Browse
            </Link>
            <button
              onClick={() => identity && run()}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
              disabled={!identity}
            >
              Re-run
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
          <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold mb-3">Log</div>
          <pre className="text-xs text-neutral-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
            {log.length ? log.join("\n") : "…"}
          </pre>
        </section>
      </main>
    </div>
  );
}
