"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDot, Copy, ExternalLink, Gauge, Radio, Users } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { ChatBox } from "@/components/chat/ChatBox";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { useIdentity } from "@/context/IdentityContext";
import { useStreamAnnounce } from "@/hooks/useStreamAnnounce";
import { useStreamPresence } from "@/hooks/useStreamPresence";
import { getNostrRelays } from "@/lib/config";
import { shortenText } from "@/lib/encoding";
import { publishEventDetailed } from "@/lib/publish";
import { pubkeyHexToNpub } from "@/lib/nostr-ids";
import { describeOriginStreamIdRules, makeOriginStreamId } from "@/lib/origin";
import { buildXmrTipReceiptEvent } from "@dstream/protocol";

type StoredBroadcastSession = { pubkey: string; streamId: string; originStreamId: string; startedAt: number };
type CheckStatus = "idle" | "checking" | "ok" | "fail";
type EscrowV3Phase =
  | "collecting_prepare"
  | "make_ready"
  | "collecting_exchange"
  | "exchange_ready"
  | "exchanged"
  | "signed"
  | "submitted";

type EscrowV3SessionResponse = {
  ok: true;
  sessionId: string;
  streamPubkey: string;
  streamId: string;
  coordinatorPubkey: string;
  participantPubkeys: string[];
  threshold: number;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  phase: EscrowV3Phase;
  prepare: {
    coordinatorMultisigInfo: string;
    participantCount: number;
    joinedPubkeys: string[];
    pendingPubkeys: string[];
    ready: boolean;
  };
  exchange: {
    round: number;
    coordinatorMultisigInfo: string | null;
    joinedPubkeys: string[];
    pendingPubkeys: string[];
    ready: boolean;
  };
  walletAddress: string | null;
  importedOutputs: number;
  signedTxids: string[];
  submittedTxids: string[];
  signedTxDataHex?: string;
  importedNow?: number;
};

function isHex64(input: string): boolean {
  return /^[0-9a-f]{64}$/i.test(input);
}

function parsePubkeysInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0 && isHex64(value))
    )
  );
}

function parseLines(input: string): string[] {
  return input
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function useStoredSession(): StoredBroadcastSession | null {
  const { identity } = useIdentity();
  const [session, setSession] = useState<StoredBroadcastSession | null>(null);

  useEffect(() => {
    const parsed = readJson<StoredBroadcastSession>("dstream_broadcast_session_v1");
    if (!parsed) {
      setSession(null);
      return;
    }
    if (!identity || parsed.pubkey !== identity.pubkey) {
      setSession(null);
      return;
    }
    setSession(parsed);
  }, [identity]);

  return session;
}

function formatXmrAtomic(amountAtomic: string): string {
  try {
    const v = BigInt(amountAtomic);
    const denom = 1_000_000_000_000n;
    const whole = v / denom;
    const frac = v % denom;
    return `${whole.toString()}.${frac.toString().padStart(12, "0")}`;
  } catch {
    return amountAtomic;
  }
}

function base64EncodeUtf8(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)));
  } catch {
    return btoa(input);
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default function DashboardPage() {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const storedSession = useStoredSession();

  const npub = useMemo(() => (identity ? pubkeyHexToNpub(identity.pubkey) : null), [identity]);

  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const [streamId, setStreamId] = useState<string>("");
  useEffect(() => {
    if (storedSession?.streamId) {
      setStreamId(storedSession.streamId);
      return;
    }
    const draft = readJson<any>("dstream_broadcast_draft_v1");
    if (draft?.streamId && typeof draft.streamId === "string") setStreamId(draft.streamId);
  }, [storedSession?.streamId]);

  const originStreamId = useMemo(() => {
    if (!identity) return null;
    if (!streamId.trim()) return null;
    return makeOriginStreamId(identity.pubkey, streamId.trim());
  }, [identity, streamId]);

  const originProblem = useMemo(() => {
    if (!identity || !streamId.trim()) return null;
    if (originStreamId) return null;
    return describeOriginStreamIdRules();
  }, [identity, originStreamId, streamId]);

  const watchHref = useMemo(() => {
    if (!identity) return "/broadcast";
    if (!streamId.trim()) return "/broadcast";
    return `/watch/${npub ?? identity.pubkey}/${streamId.trim()}`;
  }, [identity, npub, streamId]);

  const watchUrl = useMemo(() => {
    if (!origin) return watchHref;
    return `${origin}${watchHref}`;
  }, [origin, watchHref]);

  const hlsHref = useMemo(() => {
    if (!streamId.trim()) return null;
    const name = originStreamId ?? streamId.trim();
    return `/api/hls/${name}/index.m3u8`;
  }, [originStreamId, streamId]);

  const { announce, isLoading: announceLoading } = useStreamAnnounce(identity?.pubkey ?? "", streamId.trim());
  const { viewerCount, viewerPubkeys, isConnected: presenceConnected } = useStreamPresence({
    streamPubkey: identity?.pubkey ?? "",
    streamId: streamId.trim()
  });

  const [hlsStatus, setHlsStatus] = useState<CheckStatus>("idle");
  const [hlsLastCode, setHlsLastCode] = useState<number | null>(null);
  const [hlsLastAt, setHlsLastAt] = useState<number | null>(null);

  useEffect(() => {
    if (!hlsHref) {
      setHlsStatus("idle");
      setHlsLastCode(null);
      setHlsLastAt(null);
      return;
    }

    let cancelled = false;

    const check = async () => {
      setHlsStatus("checking");
      try {
        const res = await fetch(hlsHref, { cache: "no-store" });
        if (cancelled) return;
        setHlsLastCode(res.status);
        setHlsLastAt(Date.now());
        setHlsStatus(res.ok ? "ok" : "fail");
      } catch {
        if (cancelled) return;
        setHlsLastCode(null);
        setHlsLastAt(Date.now());
        setHlsStatus("fail");
      }
    };

    void check();
    const intervalMs = announce?.status === "live" ? 5_000 : 15_000;
    const interval = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [announce?.status, hlsHref]);

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyWatchLink = useCallback(async () => {
    setCopyStatus("idle");
    try {
      if (!streamId.trim()) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(watchUrl);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1200);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }, [streamId, watchUrl]);

  const streamState = useMemo(() => {
    if (!streamId.trim()) return "idle";
    if (announce?.status === "live") return "live";
    if (announce?.status === "ended") return "ended";
    if (announceLoading) return "loading";
    return "unknown";
  }, [announce?.status, announceLoading, streamId]);

  const [xmrRpcAvailable, setXmrRpcAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/xmr/health", { cache: "no-store" });
        if (cancelled) return;
        setXmrRpcAvailable(res.ok);
      } catch {
        if (cancelled) return;
        setXmrRpcAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [tipsStatus, setTipsStatus] = useState<"idle" | "loading" | "error">("idle");
  const [tipsError, setTipsError] = useState<string | null>(null);
  const [tips, setTips] = useState<
    Array<{
      amountAtomic: string;
      confirmed: boolean;
      confirmations: number;
      observedAtMs: number;
      txid: string | null;
      addressIndex: number;
    }>
  >([]);

  const refreshTips = useCallback(async () => {
    if (!identity) return;
    const sid = streamId.trim();
    if (!sid) return;
    if (!xmrRpcAvailable) return;

    setTipsStatus("loading");
    setTipsError(null);
    try {
      const url = `${window.location.origin}/api/xmr/tip/list`;
      const unsigned: any = {
        kind: 27235,
        created_at: nowSec(),
        content: "",
        tags: [
          ["u", url],
          ["method", "POST"]
        ],
        pubkey: identity.pubkey
      };
      const signed = await signEvent(unsigned);
      const auth = `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;

      const res = await fetch("/api/xmr/tip/list", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ streamPubkey: identity.pubkey, streamId: sid })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const list = Array.isArray(data?.tips) ? data.tips : [];
      setTips(
        list
          .map((t: any) => {
            if (!t || typeof t !== "object") return null;
            const amountAtomic = typeof t.amountAtomic === "string" ? t.amountAtomic : null;
            const confirmed = typeof t.confirmed === "boolean" ? t.confirmed : null;
            const confirmations = typeof t.confirmations === "number" ? t.confirmations : null;
            const observedAtMs = typeof t.observedAtMs === "number" ? t.observedAtMs : null;
            const addressIndex = typeof t.addressIndex === "number" ? t.addressIndex : null;
            if (!amountAtomic || confirmed === null || confirmations === null || observedAtMs === null || addressIndex === null) return null;
            return {
              amountAtomic,
              confirmed,
              confirmations,
              observedAtMs,
              txid: typeof t.txid === "string" ? t.txid : null,
              addressIndex
            };
          })
          .filter(Boolean) as any
      );
      setTipsStatus("idle");
    } catch (err: any) {
      setTipsStatus("error");
      setTipsError(err?.message ?? "Failed to load tips.");
    }
  }, [identity, signEvent, streamId, xmrRpcAvailable]);

  const stakeRequiredAtomic = useMemo(() => {
    const raw = announce?.stakeAmountAtomic;
    if (!raw) return null;
    try {
      const v = BigInt(raw);
      if (v <= 0n) return null;
      return raw;
    } catch {
      return null;
    }
  }, [announce?.stakeAmountAtomic]);

  const [stakesStatus, setStakesStatus] = useState<"idle" | "loading" | "error">("idle");
  const [stakesError, setStakesError] = useState<string | null>(null);
  const [stakeSlashStatusByIndex, setStakeSlashStatusByIndex] = useState<Record<number, "idle" | "slashing" | "ok" | "fail">>({});
  const [stakeSlashMessageByIndex, setStakeSlashMessageByIndex] = useState<Record<number, string>>({});
  const [stakes, setStakes] = useState<
    Array<{
      addressIndex: number;
      transferCount: number;
      totalAtomic: string;
      confirmedAtomic: string;
      confirmationsMax: number;
      observedAtMs: number | null;
      txid: string | null;
    }>
  >([]);

  const refreshStakes = useCallback(async () => {
    if (!identity) return;
    const sid = streamId.trim();
    if (!sid) return;
    if (!xmrRpcAvailable) return;
    if (!stakeRequiredAtomic) return;

    setStakesStatus("loading");
    setStakesError(null);
    try {
      const url = `${window.location.origin}/api/xmr/stake/list`;
      const unsigned: any = {
        kind: 27235,
        created_at: nowSec(),
        content: "",
        tags: [
          ["u", url],
          ["method", "POST"]
        ],
        pubkey: identity.pubkey
      };
      const signed = await signEvent(unsigned);
      const auth = `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;

      const res = await fetch("/api/xmr/stake/list", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ streamPubkey: identity.pubkey, streamId: sid })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as any;
      const list = Array.isArray(data?.stakes) ? data.stakes : [];
      setStakes(
        list
          .map((s: any) => {
            if (!s || typeof s !== "object") return null;
            const addressIndex = typeof s.addressIndex === "number" ? s.addressIndex : null;
            const transferCount = typeof s.transferCount === "number" ? s.transferCount : null;
            const totalAtomic = typeof s.totalAtomic === "string" ? s.totalAtomic : null;
            const confirmedAtomic = typeof s.confirmedAtomic === "string" ? s.confirmedAtomic : null;
            const confirmationsMax = typeof s.confirmationsMax === "number" ? s.confirmationsMax : null;
            const observedAtMs = typeof s.observedAtMs === "number" ? s.observedAtMs : null;
            if (
              addressIndex === null ||
              transferCount === null ||
              !totalAtomic ||
              !confirmedAtomic ||
              confirmationsMax === null ||
              observedAtMs === null
            ) {
              return null;
            }
            return {
              addressIndex,
              transferCount,
              totalAtomic,
              confirmedAtomic,
              confirmationsMax,
              observedAtMs,
              txid: typeof s.txid === "string" ? s.txid : null
            };
          })
          .filter(Boolean) as any
      );
      setStakesStatus("idle");
    } catch (err: any) {
      setStakesStatus("error");
      setStakesError(err?.message ?? "Failed to load stakes.");
    }
  }, [identity, signEvent, stakeRequiredAtomic, streamId, xmrRpcAvailable]);

  const makeNip98AuthHeader = useCallback(
    async (opts: { url: string; method: "GET" | "POST" }) => {
      if (!identity) throw new Error("Connect identity to authorize requests.");
      const unsigned: any = {
        kind: 27235,
        created_at: nowSec(),
        content: "",
        tags: [
          ["u", opts.url],
          ["method", opts.method]
        ],
        pubkey: identity.pubkey
      };
      const signed = await signEvent(unsigned);
      return `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;
    },
    [identity, signEvent]
  );

  const [escrowStatus, setEscrowStatus] = useState<"idle" | "working" | "error">("idle");
  const [escrowMessage, setEscrowMessage] = useState<string>("");
  const [escrowSession, setEscrowSession] = useState<EscrowV3SessionResponse | null>(null);
  const [escrowSessionIdInput, setEscrowSessionIdInput] = useState("");
  const [escrowParticipantsInput, setEscrowParticipantsInput] = useState("");
  const [escrowThresholdInput, setEscrowThresholdInput] = useState("2");
  const [escrowParticipantPhase, setEscrowParticipantPhase] = useState<"prepare" | "exchange">("prepare");
  const [escrowParticipantInfo, setEscrowParticipantInfo] = useState("");
  const [escrowImportInfosText, setEscrowImportInfosText] = useState("");
  const [escrowSignTxDataHex, setEscrowSignTxDataHex] = useState("deadbeef");
  const [escrowSubmitTxDataHex, setEscrowSubmitTxDataHex] = useState("");

  const escrowRequest = useCallback(
    async (path: string, method: "GET" | "POST", body?: any): Promise<EscrowV3SessionResponse> => {
      const url = `${window.location.origin}${path}`;
      const auth = await makeNip98AuthHeader({ url, method });
      const res = await fetch(path, {
        method,
        headers: { "content-type": "application/json", authorization: auth },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json().catch(() => null)) as EscrowV3SessionResponse | null;
      if (!data || data.ok !== true || typeof data.sessionId !== "string") throw new Error("Invalid escrow session response.");
      return data;
    },
    [makeNip98AuthHeader]
  );

  const refreshEscrowSession = useCallback(
    async (sessionIdInput?: string) => {
      const sid = (sessionIdInput ?? escrowSessionIdInput ?? escrowSession?.sessionId ?? "").trim();
      if (!sid) throw new Error("Escrow session ID is required.");
      setEscrowStatus("working");
      setEscrowMessage("");
      try {
        const data = await escrowRequest(`/api/xmr/escrow/session/${encodeURIComponent(sid)}`, "GET");
        setEscrowSession(data);
        setEscrowSessionIdInput(data.sessionId);
        setEscrowStatus("idle");
        setEscrowMessage(`Escrow session loaded (${data.phase}).`);
      } catch (err: any) {
        setEscrowStatus("error");
        setEscrowMessage(err?.message ?? "Failed to load escrow session.");
      }
    },
    [escrowRequest, escrowSession?.sessionId, escrowSessionIdInput]
  );

  const createEscrowSession = useCallback(async () => {
    if (!identity) return;
    const sid = streamId.trim();
    if (!sid) {
      setEscrowStatus("error");
      setEscrowMessage("Set a stream ID before creating escrow session.");
      return;
    }

    const participantPubkeys = parsePubkeysInput(escrowParticipantsInput);
    if (participantPubkeys.length === 0) {
      setEscrowStatus("error");
      setEscrowMessage("Add participant pubkeys (64-hex, comma or newline separated).");
      return;
    }

    const parsedThreshold = Number(escrowThresholdInput.trim());
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 2) {
      setEscrowStatus("error");
      setEscrowMessage("Threshold must be an integer >= 2.");
      return;
    }

    setEscrowStatus("working");
    setEscrowMessage("");
    try {
      const data = await escrowRequest("/api/xmr/escrow/session", "POST", {
        streamPubkey: identity.pubkey,
        streamId: sid,
        participantPubkeys,
        threshold: parsedThreshold
      });
      setEscrowSession(data);
      setEscrowSessionIdInput(data.sessionId);
      setEscrowStatus("idle");
      setEscrowMessage(`Escrow session created (${data.sessionId}).`);
    } catch (err: any) {
      setEscrowStatus("error");
      setEscrowMessage(err?.message ?? "Failed to create escrow session.");
    }
  }, [escrowParticipantsInput, escrowRequest, escrowThresholdInput, identity, streamId]);

  const submitEscrowParticipantInfo = useCallback(async () => {
    const sid = (escrowSessionIdInput || escrowSession?.sessionId || "").trim();
    if (!sid) {
      setEscrowStatus("error");
      setEscrowMessage("Escrow session ID is required.");
      return;
    }
    const multisigInfo = escrowParticipantInfo.trim();
    if (!multisigInfo) {
      setEscrowStatus("error");
      setEscrowMessage("Participant multisig info is required.");
      return;
    }

    setEscrowStatus("working");
    setEscrowMessage("");
    try {
      const data = await escrowRequest(`/api/xmr/escrow/session/${encodeURIComponent(sid)}/participant`, "POST", {
        phase: escrowParticipantPhase,
        multisigInfo
      });
      setEscrowSession(data);
      setEscrowSessionIdInput(data.sessionId);
      setEscrowStatus("idle");
      setEscrowMessage(`Participant info submitted for ${escrowParticipantPhase}.`);
      setEscrowParticipantInfo("");
    } catch (err: any) {
      setEscrowStatus("error");
      setEscrowMessage(err?.message ?? "Failed to submit participant multisig info.");
    }
  }, [escrowParticipantInfo, escrowParticipantPhase, escrowRequest, escrowSession?.sessionId, escrowSessionIdInput]);

  const runEscrowCoordinatorAction = useCallback(
    async (action: "make" | "exchange" | "import" | "sign" | "submit") => {
      const sid = (escrowSessionIdInput || escrowSession?.sessionId || "").trim();
      if (!sid) {
        setEscrowStatus("error");
        setEscrowMessage("Escrow session ID is required.");
        return;
      }

      let body: any = {};
      if (action === "import") {
        const infos = parseLines(escrowImportInfosText);
        if (infos.length === 0) {
          setEscrowStatus("error");
          setEscrowMessage("Add multisig import info lines before running import.");
          return;
        }
        body = { infos };
      } else if (action === "sign") {
        const txDataHex = escrowSignTxDataHex.trim().toLowerCase();
        if (!/^[0-9a-f]+$/.test(txDataHex)) {
          setEscrowStatus("error");
          setEscrowMessage("Sign requires hex txDataHex.");
          return;
        }
        body = { txDataHex };
      } else if (action === "submit") {
        const txDataHex = escrowSubmitTxDataHex.trim().toLowerCase();
        body = txDataHex ? { txDataHex } : {};
      }

      setEscrowStatus("working");
      setEscrowMessage("");
      try {
        const data = await escrowRequest(`/api/xmr/escrow/session/${encodeURIComponent(sid)}/${action}`, "POST", body);
        setEscrowSession(data);
        setEscrowSessionIdInput(data.sessionId);
        setEscrowStatus("idle");
        setEscrowMessage(`Escrow ${action} completed (${data.phase}).`);
      } catch (err: any) {
        setEscrowStatus("error");
        setEscrowMessage(err?.message ?? `Escrow ${action} failed.`);
      }
    },
    [
      escrowImportInfosText,
      escrowRequest,
      escrowSession?.sessionId,
      escrowSessionIdInput,
      escrowSignTxDataHex,
      escrowSubmitTxDataHex
    ]
  );

  const slashStake = useCallback(
    async (addressIndex: number) => {
      if (!identity) return;
      const sid = streamId.trim();
      if (!sid) return;
      setStakeSlashStatusByIndex((prev) => ({ ...prev, [addressIndex]: "slashing" }));
      setStakeSlashMessageByIndex((prev) => ({ ...prev, [addressIndex]: "" }));
      try {
        const path = "/api/xmr/stake/slash";
        const url = `${window.location.origin}${path}`;
        const auth = await makeNip98AuthHeader({ url, method: "POST" });
        const res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: auth },
          body: JSON.stringify({
            streamPubkey: identity.pubkey,
            streamId: sid,
            addressIndex
          })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json().catch(() => null)) as any;
        const amountAtomic = typeof data?.amountAtomic === "string" ? data.amountAtomic : "0";
        const settled = !!data?.settled;
        setStakeSlashStatusByIndex((prev) => ({ ...prev, [addressIndex]: settled ? "ok" : "idle" }));
        setStakeSlashMessageByIndex((prev) => ({
          ...prev,
          [addressIndex]: settled ? `Slashed ${formatXmrAtomic(amountAtomic)} XMR` : "No unlocked stake to slash"
        }));
        await refreshStakes();
      } catch (err: any) {
        setStakeSlashStatusByIndex((prev) => ({ ...prev, [addressIndex]: "fail" }));
        setStakeSlashMessageByIndex((prev) => ({ ...prev, [addressIndex]: err?.message ?? "Slash failed." }));
      }
    },
    [identity, makeNip98AuthHeader, refreshStakes, streamId]
  );

  const [receiptStatusByKey, setReceiptStatusByKey] = useState<Record<string, "idle" | "publishing" | "ok" | "fail">>({});
  const publishReceipt = useCallback(
    async (tip: { amountAtomic: string; confirmed: boolean; observedAtMs: number; addressIndex: number }) => {
      if (!identity) return;
      const sid = streamId.trim();
      if (!sid) return;
      const key = `${tip.observedAtMs}:${tip.amountAtomic}:${tip.addressIndex}`;

      setReceiptStatusByKey((prev) => ({ ...prev, [key]: "publishing" }));
      try {
        const unsigned: any = buildXmrTipReceiptEvent({
          pubkey: identity.pubkey,
          createdAt: nowSec(),
          streamPubkey: identity.pubkey,
          streamId: sid,
          amountAtomic: tip.amountAtomic,
          confirmed: tip.confirmed,
          observedAtMs: tip.observedAtMs
        });
        const signed = await signEvent(unsigned);
        const report = await publishEventDetailed(relays, signed as any);
        setReceiptStatusByKey((prev) => ({ ...prev, [key]: report.ok ? "ok" : "fail" }));
      } catch {
        setReceiptStatusByKey((prev) => ({ ...prev, [key]: "fail" }));
      }
    },
    [identity, relays, signEvent, streamId]
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Gauge className="w-6 h-6 text-blue-500" />
              Dashboard
            </h1>
            <p className="text-sm text-neutral-400">
              Live stream state, announce status, presence, and stream-scoped chat.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/broadcast"
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 inline-flex items-center gap-2"
            >
              <Radio className="w-4 h-4" /> Broadcast
            </Link>
            <Link
              href="/browse"
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
            >
              Browse
            </Link>
            <Link
              href="/analytics"
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
            >
              Analytics
            </Link>
          </div>
        </header>

        {!identity ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-300">
            <div className="font-semibold text-white mb-2">Connect an identity to use the dashboard.</div>
            <div className="text-neutral-400">Use the button in the header (NIP-07 preferred).</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Stream</div>
                    <div className="text-sm text-neutral-300">
                      {npub ? shortenText(npub, { head: 14, tail: 8 }) : shortenText(identity.pubkey, { head: 12, tail: 8 })}
                    </div>
                  </div>
                  {storedSession && (
                    <div className="text-xs text-neutral-500 text-right">
                      Last live:{" "}
                      <span className="font-mono text-neutral-300">{new Date(storedSession.startedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-neutral-400">Stream ID</label>
                  <input
                    value={streamId}
                    onChange={(e) => setStreamId(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. live-20260205-2015"
                  />
                  {originProblem && (
                    <div className="text-xs text-red-300">
                      Invalid Stream ID. <span className="text-red-200/80">{originProblem}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={watchHref}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
                    aria-disabled={!streamId.trim()}
                    onClick={(e) => {
                      if (!streamId.trim()) e.preventDefault();
                    }}
                  >
                    Open Watch <ExternalLink className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={copyWatchLink}
                    disabled={!streamId.trim()}
                    className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2 disabled:opacity-50"
                    title="Copy watch link"
                  >
                    <Copy className="w-4 h-4" />
                    {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy Link"}
                  </button>
                  {hlsHref && (
                    <a
                      href={hlsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-sm inline-flex items-center gap-2"
                    >
                      Open HLS <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between">
                    <span className="text-neutral-400">State</span>
                    <span
                      className={`font-mono inline-flex items-center gap-2 ${
                        streamState === "live"
                          ? "text-red-300"
                          : streamState === "ended"
                            ? "text-neutral-300"
                            : streamState === "unknown"
                              ? "text-amber-300"
                              : "text-neutral-400"
                      }`}
                    >
                      <CircleDot
                        className={`w-3.5 h-3.5 ${
                          streamState === "live"
                            ? "text-red-400"
                            : streamState === "ended"
                              ? "text-neutral-500"
                              : streamState === "unknown"
                                ? "text-amber-400"
                                : "text-neutral-600"
                        }`}
                      />
                      {streamState.toUpperCase()}
                    </span>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between">
                    <span className="text-neutral-400">Announce</span>
                    <span className="font-mono text-neutral-300">
                      {announceLoading ? "loading…" : announce ? `${announce.status} (${new Date(announce.createdAt * 1000).toLocaleTimeString()})` : "none"}
                    </span>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between">
                    <span className="text-neutral-400">Relays</span>
                    <span className="font-mono text-neutral-300">{relays.length}</span>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between">
                    <span className="text-neutral-400">HLS</span>
                    <span className="font-mono text-neutral-300">
                      {hlsStatus === "idle"
                        ? "idle"
                        : hlsStatus === "checking"
                          ? "checking…"
                          : hlsStatus === "ok"
                            ? `ready${hlsLastCode ? ` (${hlsLastCode})` : ""}`
                            : `failed${hlsLastCode ? ` (${hlsLastCode})` : ""}`}
                      {hlsLastAt ? <span className="text-neutral-500"> · {new Date(hlsLastAt).toLocaleTimeString()}</span> : null}
                    </span>
                  </div>
                </div>

                {originStreamId && (
                  <div className="text-xs text-neutral-500">
                    Origin stream: <span className="font-mono break-all text-neutral-300">{originStreamId}</span>
                  </div>
                )}
                {announce?.streaming && (
                  <div className="text-xs text-neutral-500">
                    Streaming hint: <span className="font-mono break-all text-neutral-300">{announce.streaming}</span>
                  </div>
                )}
              </div>

              {streamId.trim() ? (
                <div className="h-[70vh] lg:h-[64vh]">
                  <ChatBox streamPubkey={identity.pubkey} streamId={streamId.trim()} />
                </div>
              ) : (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
                  Enter a Stream ID to load chat and presence.
                </div>
              )}
            </div>

            <div className="space-y-6">
              {identity && streamId.trim() && xmrRpcAvailable && stakeRequiredAtomic && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <MoneroLogo className="w-5 h-5 text-orange-400" />
                      <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Stakes (P2P)</div>
                    </div>
                    <button
                      onClick={() => void refreshStakes()}
                      disabled={stakesStatus === "loading"}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                    >
                      {stakesStatus === "loading" ? "Loading…" : "Refresh"}
                    </button>
                  </div>

                  <div className="text-xs text-neutral-500">
                    Required: <span className="font-mono text-neutral-200">{formatXmrAtomic(stakeRequiredAtomic)} XMR</span> (confirmed)
                  </div>

                  {stakesError && <div className="text-xs text-red-300">{stakesError}</div>}

                  {stakes.length === 0 ? (
                    <div className="text-sm text-neutral-400">No stakes detected yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {stakes.slice(0, 12).map((s) => {
                        let satisfied = false;
                        try {
                          satisfied = BigInt(s.confirmedAtomic) >= BigInt(stakeRequiredAtomic);
                        } catch {
                          satisfied = false;
                        }
                        const slashStatus = stakeSlashStatusByIndex[s.addressIndex] ?? "idle";
                        const slashMessage = stakeSlashMessageByIndex[s.addressIndex] ?? "";
                        return (
                          <div
                            key={`${s.addressIndex}:${s.observedAtMs ?? 0}`}
                            className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-neutral-200 font-mono truncate">
                                {formatXmrAtomic(s.confirmedAtomic)} XMR
                                <span className="text-neutral-500"> confirmed</span>
                                <span className="text-neutral-500"> · subaddr {s.addressIndex}</span>
                              </div>
                              <div className="text-xs text-neutral-500">
                                {s.observedAtMs ? new Date(s.observedAtMs).toLocaleString() : "—"} · {s.transferCount} transfer(s) · max{" "}
                                {s.confirmationsMax} conf · {satisfied ? "satisfied" : "pending"}
                              </div>
                              {slashMessage ? <div className="text-xs text-neutral-500">{slashMessage}</div> : null}
                            </div>
                            <button
                              onClick={() => void slashStake(s.addressIndex)}
                              disabled={slashStatus === "slashing"}
                              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                              title="Sweep unlocked stake from this subaddress to broadcaster wallet"
                            >
                              {slashStatus === "slashing" ? "Slashing…" : slashStatus === "ok" ? "Slashed" : slashStatus === "fail" ? "Retry slash" : "Slash"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {identity && streamId.trim() && xmrRpcAvailable && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <MoneroLogo className="w-5 h-5 text-orange-400" />
                      <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Escrow v3 (multisig)</div>
                    </div>
                    <button
                      onClick={() => void refreshEscrowSession()}
                      disabled={escrowStatus === "working" || !(escrowSessionIdInput.trim() || escrowSession?.sessionId)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                    >
                      {escrowStatus === "working" ? "Working…" : "Refresh"}
                    </button>
                  </div>

                  <div className="text-xs text-neutral-500">
                    Coordinator: <span className="font-mono text-neutral-200">{shortenText(identity.pubkey, { head: 10, tail: 8 })}</span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-neutral-400">Participants (64-hex pubkeys, comma/newline separated)</label>
                    <textarea
                      value={escrowParticipantsInput}
                      onChange={(e) => setEscrowParticipantsInput(e.target.value)}
                      className="w-full min-h-[84px] bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                      placeholder="hexpubkey1, hexpubkey2"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-neutral-400">Threshold</label>
                      <input
                        value={escrowThresholdInput}
                        onChange={(e) => setEscrowThresholdInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-xs text-neutral-400">Session ID</label>
                      <input
                        value={escrowSessionIdInput}
                        onChange={(e) => setEscrowSessionIdInput(e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                        placeholder="auto-filled after create"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void createEscrowSession()}
                      disabled={escrowStatus === "working"}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-bold disabled:opacity-50"
                    >
                      Create Session
                    </button>
                    <button
                      onClick={() => void refreshEscrowSession()}
                      disabled={escrowStatus === "working" || !(escrowSessionIdInput.trim() || escrowSession?.sessionId)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                    >
                      Load Session
                    </button>
                  </div>

                  {escrowMessage ? (
                    <div className={`text-xs ${escrowStatus === "error" ? "text-red-300" : "text-neutral-400"}`}>{escrowMessage}</div>
                  ) : null}

                  {escrowSession && (
                    <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="text-neutral-500">
                          Phase: <span className="font-mono text-neutral-200">{escrowSession.phase}</span>
                        </div>
                        <div className="text-neutral-500">
                          Threshold: <span className="font-mono text-neutral-200">{escrowSession.threshold}</span>
                        </div>
                        <div className="text-neutral-500">
                          Participants: <span className="font-mono text-neutral-200">{escrowSession.participantPubkeys.length}</span>
                        </div>
                        <div className="text-neutral-500">
                          Exchange round: <span className="font-mono text-neutral-200">{escrowSession.exchange.round}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs text-neutral-500">Coordinator prepare info</div>
                        <textarea
                          readOnly
                          value={escrowSession.prepare.coordinatorMultisigInfo || ""}
                          className="w-full min-h-[70px] bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-300"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs text-neutral-500">Coordinator exchange info</div>
                        <textarea
                          readOnly
                          value={escrowSession.exchange.coordinatorMultisigInfo || ""}
                          className="w-full min-h-[64px] bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-300"
                        />
                      </div>

                      <div className="text-xs text-neutral-500">
                        Pending prepare:{" "}
                        <span className="font-mono text-neutral-300">
                          {escrowSession.prepare.pendingPubkeys.length
                            ? escrowSession.prepare.pendingPubkeys.map((pk) => shortenText(pk, { head: 8, tail: 6 })).join(", ")
                            : "none"}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500">
                        Pending exchange:{" "}
                        <span className="font-mono text-neutral-300">
                          {escrowSession.exchange.pendingPubkeys.length
                            ? escrowSession.exchange.pendingPubkeys.map((pk) => shortenText(pk, { head: 8, tail: 6 })).join(", ")
                            : "none"}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => void runEscrowCoordinatorAction("make")}
                          disabled={escrowStatus === "working"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          Make
                        </button>
                        <button
                          onClick={() => void runEscrowCoordinatorAction("exchange")}
                          disabled={escrowStatus === "working"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          Exchange
                        </button>
                        <button
                          onClick={() => void runEscrowCoordinatorAction("import")}
                          disabled={escrowStatus === "working"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          Import
                        </button>
                        <button
                          onClick={() => void runEscrowCoordinatorAction("sign")}
                          disabled={escrowStatus === "working"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          Sign
                        </button>
                        <button
                          onClick={() => void runEscrowCoordinatorAction("submit")}
                          disabled={escrowStatus === "working"}
                          className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50 col-span-2"
                        >
                          Submit
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs text-neutral-500">Import infos (one per line)</div>
                        <textarea
                          value={escrowImportInfosText}
                          onChange={(e) => setEscrowImportInfosText(e.target.value)}
                          className="w-full min-h-[72px] bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                          placeholder="peer_export_a&#10;peer_export_b"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <div className="text-xs text-neutral-500">Sign txDataHex</div>
                          <input
                            value={escrowSignTxDataHex}
                            onChange={(e) => setEscrowSignTxDataHex(e.target.value)}
                            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-neutral-500">Submit txDataHex (optional override)</div>
                          <input
                            value={escrowSubmitTxDataHex}
                            onChange={(e) => setEscrowSubmitTxDataHex(e.target.value)}
                            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                            placeholder="uses signed tx if empty"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 border-t border-neutral-800 pt-3">
                        <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Participant Join</div>
                        <div className="flex gap-2">
                          <select
                            value={escrowParticipantPhase}
                            onChange={(e) => setEscrowParticipantPhase(e.target.value === "exchange" ? "exchange" : "prepare")}
                            className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:border-orange-500 focus:outline-none"
                          >
                            <option value="prepare">prepare</option>
                            <option value="exchange">exchange</option>
                          </select>
                          <button
                            onClick={() => void submitEscrowParticipantInfo()}
                            disabled={escrowStatus === "working"}
                            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                          >
                            Submit Participant Info
                          </button>
                        </div>
                        <textarea
                          value={escrowParticipantInfo}
                          onChange={(e) => setEscrowParticipantInfo(e.target.value)}
                          className="w-full min-h-[64px] bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-[11px] font-mono text-neutral-200 focus:border-orange-500 focus:outline-none"
                          placeholder="participant multisig info"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {identity && streamId.trim() && xmrRpcAvailable && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <MoneroLogo className="w-5 h-5 text-orange-400" />
                      <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Verified tips</div>
                    </div>
                    <button
                      onClick={() => void refreshTips()}
                      disabled={tipsStatus === "loading"}
                      className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                    >
                      {tipsStatus === "loading" ? "Loading…" : "Refresh"}
                    </button>
                  </div>

                  {tipsError && <div className="text-xs text-red-300">{tipsError}</div>}

                  {tips.length === 0 ? (
                    <div className="text-sm text-neutral-400">No verified tips detected yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {tips.slice(0, 12).map((t) => {
                        const key = `${t.observedAtMs}:${t.amountAtomic}:${t.addressIndex}`;
                        const status = receiptStatusByKey[key] ?? "idle";
                        return (
                          <div
                            key={key}
                            className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-neutral-200 font-mono truncate">
                                {formatXmrAtomic(t.amountAtomic)} XMR
                                <span className="text-neutral-500"> · subaddr {t.addressIndex}</span>
                              </div>
                              <div className="text-xs text-neutral-500">
                                {new Date(t.observedAtMs).toLocaleString()} · {t.confirmed ? "confirmed" : `unconfirmed (${t.confirmations})`}
                              </div>
                            </div>
                            <button
                              onClick={() => void publishReceipt(t)}
                              disabled={status === "publishing"}
                              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                              title="Publish a kind 30314 receipt to configured relays"
                            >
                              {status === "publishing" ? "Publishing…" : status === "ok" ? "Receipt OK" : status === "fail" ? "Receipt failed" : "Publish receipt"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-mono text-neutral-400 uppercase tracking-wider font-bold">Presence</div>
                  {presenceConnected && <span className="text-[10px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">live</span>}
                </div>

                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-neutral-950/40 border border-neutral-800 text-neutral-300">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm text-neutral-200">
                      <span className="text-neutral-400">Viewers</span> <span className="font-mono">≈ {streamId.trim() ? viewerCount : 0}</span>
                    </div>
                    <div className="text-xs text-neutral-500">Best-effort, based on recent presence events.</div>
                  </div>
                </div>

                {streamId.trim() && viewerPubkeys.length > 0 && (
                  <div className="text-xs text-neutral-500">
                    <div className="mb-2">Recent viewers</div>
                    <div className="flex flex-wrap gap-2">
                      {viewerPubkeys.slice(0, 18).map((pk) => {
                        const n = pubkeyHexToNpub(pk);
                        return (
                          <span key={pk} className="px-2 py-1 rounded-lg bg-neutral-950/40 border border-neutral-800 font-mono text-neutral-300">
                            {shortenText(n ?? pk, { head: n ? 10 : 8, tail: 6 })}
                          </span>
                        );
                      })}
                      {viewerPubkeys.length > 18 && (
                        <span className="px-2 py-1 rounded-lg bg-neutral-950/40 border border-neutral-800 font-mono text-neutral-500">
                          +{viewerPubkeys.length - 18}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-2 text-sm text-neutral-300">
                <div className="font-semibold">Relays</div>
                <div className="text-xs text-neutral-500">Configured relay(s):</div>
                <div className="text-xs font-mono text-neutral-300 break-all">{relays.join(", ")}</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
