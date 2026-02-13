"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildStreamAnnounceEvent, buildStreamChatEvent, buildStreamPresenceEvent, deriveSwarmId } from "@dstream/protocol";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { Player } from "@/components/Player";
import { ChatBox } from "@/components/chat/ChatBox";
import { useIdentity } from "@/context/IdentityContext";
import { useStreamChat } from "@/hooks/useStreamChat";
import { publishEvent } from "@/lib/publish";
import { WhipClient } from "@/lib/whip";
import { runP2PDataChannelHandshake } from "@/lib/p2p/webrtcHandshake";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { describeOriginStreamIdRules, makeOriginStreamId } from "@/lib/origin";

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

function makeStreamId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `whip-smoke-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const E2E_PUBLISH_OPTIONS = {
  poolTimeoutMs: 3000,
  fallbackTimeoutMs: 2000
} as const;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function createSyntheticStream(opts: { width?: number; height?: number; fps?: number; label?: string; onLog?: (line: string) => void }) {
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const fps = opts.fps ?? 15;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // Safari can fail to produce frames from captureStream() if the canvas is never attached to the DOM.
  // Keep it tiny and nearly-transparent so it doesn't affect the UI.
  try {
    canvas.style.position = "fixed";
    canvas.style.right = "0";
    canvas.style.bottom = "0";
    canvas.style.width = "2px";
    canvas.style.height = "2px";
    canvas.style.opacity = "0.01";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);
  } catch {
    // ignore
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const captureStream = (canvas as any).captureStream?.bind(canvas);
  if (!captureStream) throw new Error("canvas.captureStream() not supported in this browser.");

  const stream: MediaStream = captureStream(fps);
  const videoTrack: any = stream.getVideoTracks()[0];
  const requestFrame = typeof videoTrack?.requestFrame === "function" ? () => videoTrack.requestFrame() : null;

  const start = performance.now();

  const draw = () => {
    const t = performance.now();
    const elapsed = (t - start) / 1000;
    const hue = Math.floor((elapsed * 50) % 360);

    ctx.fillStyle = `hsl(${hue} 70% 10%)`;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = `hsl(${(hue + 80) % 360} 80% 55%)`;
    const barW = Math.floor(width * 0.7);
    const barH = 14;
    const x = Math.floor((width - barW) / 2);
    const y = Math.floor(height * 0.35 + Math.sin(elapsed * 2) * 40);
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 48px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(opts.label ?? "dStream WHIP Smoke", 60, 110);

    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(new Date().toISOString(), 60, 150);
    ctx.fillText(`fps=${fps}  ${width}x${height}`, 60, 175);
  };

  // Draw a first frame after captureStream() is active (Safari can otherwise publish "no tracks").
  draw();
  requestFrame?.();

  // Use a timer (not RAF) so background tabs still emit frames.
  const tickMs = Math.max(Math.floor(1000 / Math.max(1, fps)), 33);
  const interval = window.setInterval(() => {
    draw();
    requestFrame?.();
  }, tickMs);

  opts.onLog?.(`Synthetic stream created (${width}x${height}@${fps}). Tracks: ${stream.getTracks().map((t) => t.kind).join(", ")}`);

  const stop = () => {
    window.clearInterval(interval);
    stream.getTracks().forEach((t) => t.stop());
    try {
      canvas.remove();
    } catch {
      // ignore
    }
  };

  return { stream, canvas, stop };
}

async function logToServer(line: string) {
  try {
    await fetch("/api/dev/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line })
    });
  } catch {
    // ignore
  }
}

async function clearServerLog() {
  try {
    await fetch("/api/dev/log", { method: "DELETE" });
  } catch {
    // ignore
  }
}

export default function E2EClient() {
  const { identity, generateLocal, logout, signEvent } = useIdentity();
  const relays = useMemo(() => ["ws://localhost:8081"], []);

  const forceLocal = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("forceLocal") === "1";
    } catch {
      return false;
    }
  }, []);

  const integrityMode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("integrity") === "1";
    } catch {
      return false;
    }
  }, []);

  const streamId = useMemo(() => makeStreamId(), []);
  const originStreamId = useMemo(() => (identity ? makeOriginStreamId(identity.pubkey, streamId) : null), [identity, streamId]);
  const hlsUrl = useMemo(() => {
    const streamName = originStreamId ?? streamId;
    return `/api/hls/${streamName}/index.m3u8`;
  }, [originStreamId, streamId]);
  const announceHlsUrl = useMemo(() => {
    const streamName = originStreamId ?? streamId;
    return integrityMode ? `/api/dev/tamper-hls/${streamName}/index.m3u8` : `/api/hls/${streamName}/index.m3u8`;
  }, [integrityMode, originStreamId, streamId]);
  const whipEndpoint = useMemo(() => `/api/whip/${originStreamId ?? streamId}/whip`, [originStreamId, streamId]);
  const watchHref = useMemo(
    () => (identity ? `/watch/${pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey}/${streamId}` : `/watch/npub/${streamId}`),
    [identity, streamId]
  );

  const whipRef = useRef<WhipClient | null>(null);
  const synthStopRef = useRef<(() => void) | null>(null);
  const watchIframeRef = useRef<HTMLIFrameElement | null>(null);
  const watchReadyRef = useRef(false);
  const watchChatReadyRef = useRef(false);
  const chatRxStateRef = useRef<StepStatus>("pending");
  const chatRxLoggedRef = useRef(false);
  const ranRef = useRef(false);
  const requestedIdentityRef = useRef(false);

  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [identityStep, setIdentityStep] = useState<StepStatus>("pending");
  const [whipStep, setWhipStep] = useState<StepStatus>("pending");
  const [hlsStep, setHlsStep] = useState<StepStatus>("pending");
  const [announceStep, setAnnounceStep] = useState<StepStatus>("pending");
  const [chatStep, setChatStep] = useState<StepStatus>("pending");
  const [chatRxStep, setChatRxStep] = useState<StepStatus>("pending");
  const [presenceStep, setPresenceStep] = useState<StepStatus>("pending");
  const [p2pStep, setP2pStep] = useState<StepStatus>("pending");
  const [watchStep, setWatchStep] = useState<StepStatus>("pending");
  const [manifestSignerPubkey, setManifestSignerPubkey] = useState<string | null>(null);

  const [expectedChatId, setExpectedChatId] = useState<string | null>(null);
  const [watchIframeSrc, setWatchIframeSrc] = useState<string | null>(null);

  const { messages: observedChatMessages } = useStreamChat({
    streamPubkey: identity?.pubkey ?? "",
    streamId
  });

  const fetchManifestSigner = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/manifest/identity", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as any;
      const pk = typeof data?.pubkey === "string" ? data.pubkey.trim() : "";
      return pk || null;
    } catch {
      return null;
    }
  }, []);

  const getManifestSigner = useCallback(async (): Promise<string | null> => {
    if (manifestSignerPubkey) return manifestSignerPubkey;
    const pk = await fetchManifestSigner();
    if (pk) setManifestSignerPubkey(pk);
    return pk;
  }, [fetchManifestSigner, manifestSignerPubkey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pk = await fetchManifestSigner();
      if (!pk) return;
      if (cancelled) return;
      setManifestSignerPubkey(pk);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchManifestSigner]);

  const pushLog = useCallback((line: string) => {
    const stamped = `${new Date().toLocaleTimeString()} ${line}`;
    setLog((prev) => [...prev.slice(-350), stamped]);
    void logToServer(stamped);
  }, []);

  const setFatal = useCallback(
    (msg: string) => {
      setError(msg);
      pushLog(`FATAL: ${msg}`);
    },
    [pushLog]
  );

  const onWatchIframeLoad = useCallback(() => {
    pushLog("Watch iframe: load");
    try {
      const href = watchIframeRef.current?.contentWindow?.location?.href;
      if (href) pushLog(`Watch iframe: ${href}`);
    } catch {
      pushLog("Watch iframe: location unavailable");
    }
  }, [pushLog]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      pushLog(`window.error: ${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      pushLog(`unhandledrejection: ${String((e as any).reason ?? e)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [pushLog]);

  useEffect(() => {
    chatRxStateRef.current = chatRxStep;
  }, [chatRxStep]);

  const markChatReceiveOk = useCallback(() => {
    if (chatRxLoggedRef.current) return;
    chatRxLoggedRef.current = true;
    chatRxStateRef.current = "ok";
    setChatRxStep("ok");
    pushLog("Chat receive: ok");
  }, [pushLog]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data: any = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "dstream:e2e") return;
      if (data.streamId !== streamId) return;

      if (data.t === "watch_loaded") {
        pushLog("Watch loaded: ok");
        return;
      }

      if (data.t === "watch_integrity_tamper") {
        pushLog("Integrity tamper: ok");
        return;
      }

      if (data.t === "watch_integrity_verified") {
        pushLog("Integrity verified: ok");
        return;
      }

      if (data.t === "watch_player_ready") {
        if (watchReadyRef.current) return;
        watchReadyRef.current = true;
        setWatchStep("ok");
        pushLog("Watch player: ok");
        return;
      }

      if (data.t === "watch_chat_ready") {
        pushLog("Watch chat: ok");
        watchChatReadyRef.current = true;
        if (chatRxStateRef.current === "running") markChatReceiveOk();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [markChatReceiveOk, pushLog, streamId]);

  useEffect(() => {
    if (watchStep !== "running") return;
    watchReadyRef.current = false;

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (watchReadyRef.current) return;

      try {
        const doc = watchIframeRef.current?.contentDocument;
        const status = doc?.querySelector('[data-testid="player-status"]')?.textContent?.trim();
        if (!status) return;

        if (status === "Ready" || status === "Click to play") {
          watchReadyRef.current = true;
          setWatchStep("ok");
          pushLog("Watch player: ok");
          window.clearInterval(interval);
        }
      } catch {
        // ignore (cross-origin / not ready)
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pushLog, watchStep]);

  useEffect(() => {
    if (chatRxStep !== "running") return;
    if (!watchChatReadyRef.current) return;
    markChatReceiveOk();
  }, [chatRxStep, markChatReceiveOk]);

  useEffect(() => {
    if (!expectedChatId) return;
    if (chatRxStep !== "running") return;
    if (!observedChatMessages.some((m) => m.id === expectedChatId)) return;
    markChatReceiveOk();
  }, [chatRxStep, expectedChatId, markChatReceiveOk, observedChatMessages]);

  useEffect(() => {
    if (chatRxStep !== "running") return;
    const timer = setTimeout(() => setFatal("Chat receive timeout."), 35_000);
    return () => clearTimeout(timer);
  }, [chatRxStep, setFatal]);

  useEffect(() => {
    if (watchStep !== "running") return;
    const timer = setTimeout(() => setFatal("Watch player timeout."), integrityMode ? 60_000 : 25_000);
    return () => clearTimeout(timer);
  }, [integrityMode, setFatal, watchStep]);

  const announce = useCallback(
    async (nextStatus: "live" | "ended") => {
      if (!identity) throw new Error("No identity.");

      const signer = nextStatus === "live" ? await getManifestSigner() : null;
      const unsigned: any = buildStreamAnnounceEvent({
        pubkey: identity.pubkey,
        createdAt: nowSec(),
        streamId,
        title: `WHIP Smoke (${streamId})`,
        status: nextStatus,
        summary: "Automated WHIP publish + Nostr announce + chat (dev-only).",
        streaming: nextStatus === "live" ? `${window.location.origin}${announceHlsUrl}` : undefined,
        manifestSignerPubkey: signer ?? undefined,
        topics: ["whip", "smoke", "local"]
      });

      const signed = await signEvent(unsigned);
      let ok = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        ok = await publishEvent(relays, signed, E2E_PUBLISH_OPTIONS);
        if (ok) break;
        await sleep(500);
      }
      pushLog(`Announce(${nextStatus}) publish: ${ok ? "ok" : "failed"} id=${signed.id}`);
      return ok;
    },
    [announceHlsUrl, getManifestSigner, identity, pushLog, relays, signEvent, streamId]
  );

  const publishChat = useCallback(async () => {
    if (!identity) throw new Error("No identity.");

    const unsigned: any = buildStreamChatEvent({
      pubkey: identity.pubkey,
      createdAt: nowSec(),
      streamPubkey: identity.pubkey,
      streamId,
      content: `hello from /dev/e2e @ ${new Date().toLocaleTimeString()}`
    });
    const signed = await signEvent(unsigned);
    let ok = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      ok = await publishEvent(relays, signed, E2E_PUBLISH_OPTIONS);
      if (ok) break;
      await sleep(500);
    }
    pushLog(`Chat publish: ${ok ? "ok" : "failed"} id=${signed.id}`);
    return { ok, id: signed.id };
  }, [identity, pushLog, relays, signEvent, streamId]);

  const publishPresence = useCallback(async () => {
    if (!identity) throw new Error("No identity.");

    const unsigned: any = buildStreamPresenceEvent({
      pubkey: identity.pubkey,
      createdAt: nowSec(),
      streamPubkey: identity.pubkey,
      streamId
    });
    const signed = await signEvent(unsigned);
    let ok = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      ok = await publishEvent(relays, signed, E2E_PUBLISH_OPTIONS);
      if (ok) break;
      await sleep(500);
    }
    pushLog(`Presence publish: ${ok ? "ok" : "failed"} id=${signed.id}`);
    return ok;
  }, [identity, pushLog, relays, signEvent, streamId]);

  const cleanupMedia = useCallback(() => {
    try {
      whipRef.current?.close();
      whipRef.current = null;
    } catch {
      // ignore
    }
    try {
      synthStopRef.current?.();
      synthStopRef.current = null;
    } catch {
      // ignore
    }
  }, []);

  const end = useCallback(async () => {
    pushLog("Ending stream…");
    cleanupMedia();
    if (identity) {
      try {
        await announce("ended");
      } catch {
        // ignore
      }
    }
  }, [announce, cleanupMedia, identity, pushLog]);

  const run = useCallback(async () => {
    if (!identity) return;
    if (!originStreamId) {
      setFatal(`Invalid Stream ID. ${describeOriginStreamIdRules()}`);
      return;
    }

    await clearServerLog();
    setLog([]);
    setError(null);

    setIdentityStep("ok");
    setWhipStep("running");
    setHlsStep("running");
    setAnnounceStep("running");
    setChatStep("running");
    setChatRxStep("pending");
    chatRxStateRef.current = "pending";
    chatRxLoggedRef.current = false;
    watchChatReadyRef.current = false;
    setPresenceStep("running");
    setP2pStep("running");
    setWatchStep("pending");
    setExpectedChatId(null);
    setWatchIframeSrc(null);

    pushLog(`Relay: ${relays.join(", ")}`);
    pushLog(`Stream ID: ${streamId}`);
    pushLog(`Origin stream: ${originStreamId}`);
    pushLog(`WHIP endpoint: ${whipEndpoint}`);
    pushLog(`HLS url (preview): ${hlsUrl}`);
    if (announceHlsUrl !== hlsUrl) pushLog(`HLS url (announce): ${announceHlsUrl}`);
    pushLog(`Pubkey: ${identity.pubkey}`);
    pushLog(`Npub: ${pubkeyHexToNpub(identity.pubkey) ?? identity.pubkey}`);
    if (integrityMode) pushLog(`Manifest signer: ${(await getManifestSigner()) ?? "unavailable"}`);

    const maxPublishAttempts = 3;
    const maxHlsChecksPerAttempt = 18;
    let streamReady = false;
    let lastFailure = "HLS playlist never became available (timeout).";

    for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
      if (attempt > 1) pushLog(`WHIP retry attempt ${attempt}/${maxPublishAttempts}…`);

      cleanupMedia();

      try {
        const { stream, stop } = createSyntheticStream({
          width: 640,
          height: 360,
          fps: 15,
          label: "dStream WHIP Smoke",
          onLog: pushLog
        });
        synthStopRef.current = stop;

        const client = new WhipClient(whipEndpoint);
        whipRef.current = client;
        pushLog("Publishing via WHIP…");
        await client.publish(stream);
        setWhipStep("ok");
        pushLog("WHIP publish: ok");
      } catch (e: any) {
        lastFailure = e?.message ?? "WHIP publish failed.";
        pushLog(`WHIP publish attempt ${attempt} failed: ${lastFailure}`);
        if (attempt >= maxPublishAttempts) {
          setWhipStep("fail");
          setHlsStep("fail");
          setFatal(lastFailure);
          return;
        }
        await sleep(750);
        continue;
      }

      let hlsOk = false;
      for (let i = 0; i < maxHlsChecksPerAttempt; i++) {
        try {
          const res = await fetchWithTimeout(hlsUrl, { cache: "no-store" }, 3000);
          pushLog(`HLS check: ${res.status}`);
          if (res.ok) {
            hlsOk = true;
            break;
          }
        } catch (e: any) {
          const label = e?.name ? String(e.name) : "error";
          pushLog(`HLS check: ${label}`);
        }
        await sleep(750);
      }

      if (hlsOk) {
        streamReady = true;
        setHlsStep("ok");
        break;
      }

      pushLog(`HLS not ready after WHIP attempt ${attempt}.`);
      if (attempt < maxPublishAttempts) {
        setWhipStep("running");
        setHlsStep("running");
        await sleep(1000);
      }
    }

    if (!streamReady) {
      setWhipStep("fail");
      setHlsStep("fail");
      setFatal(lastFailure);
      return;
    }

    try {
      const ok = await announce("live");
      setAnnounceStep(ok ? "ok" : "fail");
    } catch (e: any) {
      setAnnounceStep("fail");
      pushLog(`Announce error: ${e?.message ?? String(e)}`);
    }

    try {
      const params = new URLSearchParams({ e2e: "1" });
      params.set("hls", announceHlsUrl);
      if (integrityMode) {
        const signer = await getManifestSigner();
        if (signer) params.set("manifest", signer);
      }
      const url = `${watchHref}?${params.toString()}`;
      setWatchStep("running");
      setWatchIframeSrc(url);
      pushLog(`Watch probe: ${url}`);
    } catch {
      // ignore
    }

    try {
      const res = await publishChat();
      setChatStep(res.ok ? "ok" : "fail");
      if (res.ok && res.id) {
        setExpectedChatId(res.id);
        setChatRxStep("running");
      } else {
        setChatRxStep("fail");
      }
    } catch (e: any) {
      setChatStep("fail");
      setChatRxStep("fail");
      pushLog(`Chat error: ${e?.message ?? String(e)}`);
    }

    try {
      const ok = await publishPresence();
      setPresenceStep(ok ? "ok" : "fail");
    } catch (e: any) {
      setPresenceStep("fail");
      pushLog(`Presence error: ${e?.message ?? String(e)}`);
    }

    try {
      const swarmId = await deriveSwarmId({ streamPubkey: identity.pubkey, streamId });
      pushLog(`Swarm ID: ${swarmId}`);
      const result = await runP2PDataChannelHandshake({
        relays,
        streamPubkey: identity.pubkey,
        streamId,
        swarmId,
        onLog: pushLog
      });
      setP2pStep(result.ok ? "ok" : "fail");
      pushLog(`P2P datachannel: ${result.ok ? "ok" : `failed (${result.reason ?? "unknown"})`}`);
    } catch (e: any) {
      setP2pStep("fail");
      pushLog(`P2P datachannel: failed (${e?.message ?? String(e)})`);
    }
  }, [
    announce,
    getManifestSigner,
    announceHlsUrl,
    cleanupMedia,
    hlsUrl,
    identity,
    integrityMode,
    originStreamId,
    publishChat,
    publishPresence,
    pushLog,
    relays,
    setFatal,
    streamId,
    whipEndpoint,
    watchHref
  ]);

  useEffect(() => {
    if (ranRef.current) return;

    if (forceLocal && identity && identity.kind !== "local") {
      if (requestedIdentityRef.current) return;
      requestedIdentityRef.current = true;
      setIdentityStep("running");
      pushLog("forceLocal=1: switching to a local dev key (avoids NIP-07 prompts)…");
      logout();
      void generateLocal().catch((e: any) => {
        setIdentityStep("fail");
        setFatal(e?.message ?? "Failed to generate local key.");
      });
      return;
    }

    if (!identity) {
      if (requestedIdentityRef.current) return;
      requestedIdentityRef.current = true;
      setIdentityStep("running");
      pushLog("No identity found; generating local dev key…");
      void generateLocal().catch((e: any) => {
        setIdentityStep("fail");
        setFatal(e?.message ?? "Failed to generate local key.");
      });
      return;
    }

    ranRef.current = true;
    setIdentityStep("ok");
    void run();
  }, [forceLocal, generateLocal, identity, logout, pushLog, run, setFatal]);

  useEffect(() => cleanupMedia, [cleanupMedia]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />

      <main className="relative max-w-7xl mx-auto p-6 space-y-6">
        {watchIframeSrc && (
          <iframe
            src={watchIframeSrc}
            title="e2e-watch-probe"
            ref={watchIframeRef}
            onLoad={onWatchIframeLoad}
            className="absolute -left-[10000px] top-0 w-[320px] h-[180px] opacity-0 pointer-events-none"
          />
        )}
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Dev E2E Runner</h1>
          <p className="text-sm text-neutral-300">
            Automated: synthetic media → WHIP publish → HLS appears → Nostr announce → chat (send+receive) → watch playback → presence → P2P.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(identityStep)}`}>Identity</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(whipStep)}`}>WHIP publish</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(hlsStep)}`}>HLS ready</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(announceStep)}`}>Announce</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(chatStep)}`}>Chat tx</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(chatRxStep)}`}>Chat rx</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(watchStep)}`}>Watch</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(presenceStep)}`}>Presence</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClass(p2pStep)}`}>P2P</span>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm text-neutral-300">
            <div>
              <div className="text-xs text-neutral-500">Relay</div>
              <div className="font-mono break-all">{relays.join(", ")}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Stream</div>
              <div className="font-mono break-all">{streamId}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Pubkey</div>
              <div className="font-mono break-all">{identity?.pubkey ?? "…"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href={watchHref} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold">
              Open Watch
            </Link>
            <a
              href="/api/dev/log"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
            >
              Open Log API
            </a>
            <button
              onClick={() => void end()}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
            >
              End Stream
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm"
            >
              Reload (new run)
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Player src={hlsUrl} />
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold mb-3">Log</div>
              <pre className="text-xs text-neutral-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
                {log.length ? log.join("\n") : "…"}
              </pre>
            </div>
          </div>

          <div className="h-[70vh] lg:h-auto">
            <ChatBox streamPubkey={identity?.pubkey ?? ""} streamId={streamId} />
          </div>
        </div>
      </main>
    </div>
  );
}
