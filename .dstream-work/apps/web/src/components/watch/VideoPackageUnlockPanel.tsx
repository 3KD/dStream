"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDot, Clock3, Copy, ExternalLink, XCircle } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { useSocial } from "@/context/SocialContext";
import {
  buildAccessPurchaseProof,
  buildAccessViewerProof,
  createVideoPackagePaymentSessionClient,
  getVideoPackagePaymentSessionStatusClient,
  listVideoAccessPackagesClient,
  listVideoPackageViewerStatusClient,
  observeVideoPackagePaymentSessionClient,
  type VideoAccessPackage,
  type VideoPackagePaymentSession,
  type VideoPackageViewerUnlock
} from "@/lib/access/client";
import { readVideoPackagePaymentSessionConfig } from "@/lib/access/paymentSessionConfig";
import { getNostrRelays } from "@/lib/config";
import { shortenText } from "@/lib/encoding";
import { PAYMENT_ASSET_META, buildPaymentUri, getWalletIntegrationById } from "@/lib/payments/catalog";
import { getPaymentRailForAsset } from "@/lib/payments/rails";
import {
  getNativeWalletCapability,
  nativeWalletProviderLabel,
  nativeWalletSendNeedsAmount,
  sendNativeWalletPayment,
  supportsNativeWalletPayment,
  type NativeWalletCapability
} from "@/lib/payments/nativeWallet";
import { paymentSessionTargetToMethod, paymentSettlementTargetToMethod } from "@/lib/payments/targets";
import { buildZapRequestUnsigned } from "@/lib/zaps";
import type { NostrEvent, PaymentRailId, PaymentSessionStatus, PaymentSettlementProof, StreamPaymentMethod } from "@dstream/protocol";

interface VideoPackageUnlockPanelProps {
  hostPubkey: string;
  streamId: string;
  originStreamId: string;
  accessError?: string | null;
  accessBusy?: boolean;
  onPlaybackAccessRequested: () => Promise<boolean>;
}

type NativeSendStatus = { ok: boolean; message: string; txId?: string };
type PaymentTimelineStepState = "done" | "active" | "waiting" | "error";
type PaymentTargetType = VideoPackagePaymentSession["target"]["targetType"];

interface PaymentTimelineStep {
  id: string;
  label: string;
  detail: string;
  state: PaymentTimelineStepState;
  meta?: string | null;
}

function formatDurationHours(durationHours: number): string {
  if (durationHours % 24 === 0) {
    const days = durationHours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${durationHours} hour${durationHours === 1 ? "" : "s"}`;
}

function formatUnlockExpiry(unlock: VideoPackageViewerUnlock | undefined): string | null {
  if (!unlock?.expiresAtSec) return null;
  return new Date(unlock.expiresAtSec * 1000).toLocaleString();
}

function formatPaymentSessionStatus(status: PaymentSessionStatus): string {
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "pending_operator") return "Waiting for operator verification";
  if (status === "observed") return "Payment observed";
  if (status === "verified") return "Settlement verified";
  if (status === "granted") return "Access granted";
  if (status === "expired") return "Session expired";
  if (status === "failed") return "Session failed";
  if (status === "cancelled") return "Session cancelled";
  return "Session created";
}

function parseBtcAmountToSats(amountRaw: string): number | null {
  const raw = amountRaw.trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fractionRaw = match[2] ?? "";
  if (fractionRaw.length > 8) return null;
  const fraction = fractionRaw.padEnd(8, "0");
  const sats = Number(whole) * 100_000_000 + Number(fraction || "0");
  if (!Number.isSafeInteger(sats) || sats <= 0) return null;
  return sats;
}

function isTerminalSession(status: PaymentSessionStatus): boolean {
  return status === "granted" || status === "expired" || status === "failed" || status === "cancelled";
}

function isErrorSession(status: PaymentSessionStatus): boolean {
  return status === "expired" || status === "failed" || status === "cancelled";
}

function formatSessionTimestamp(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSessionExpiry(session: VideoPackagePaymentSession): string | null {
  const expiresAt = formatSessionTimestamp(session.expiresAtMs);
  if (!expiresAt || session.status === "granted") return null;
  return `expires ${expiresAt}`;
}

function paymentTimelineStateClass(state: PaymentTimelineStepState): string {
  if (state === "done") return "border-emerald-700/50 bg-emerald-950/25 text-emerald-200";
  if (state === "active") return "border-blue-700/50 bg-blue-950/25 text-blue-200";
  if (state === "error") return "border-red-700/50 bg-red-950/25 text-red-200";
  return "border-neutral-800 bg-neutral-950/45 text-neutral-400";
}

function paymentTimelineIcon(state: PaymentTimelineStepState) {
  if (state === "done") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />;
  if (state === "active") return <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />;
  if (state === "error") return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />;
  return <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />;
}

function buildPaymentTimelineSteps(input: {
  session: VideoPackagePaymentSession;
  hasTarget: boolean;
  nativeState?: NativeSendStatus;
}): PaymentTimelineStep[] {
  const { session, hasTarget, nativeState } = input;
  const terminalError = isErrorSession(session.status);
  const observedOrBetter = session.status === "observed" || session.status === "verified" || session.status === "granted";
  const verifiedOrGranted = session.status === "verified" || session.status === "granted";
  const submittedTxRef = nativeState?.txId ?? session.settlement?.txRef ?? session.settlement?.settlementRef ?? null;
  const paymentSubmitted = !!submittedTxRef || observedOrBetter;
  const proofLabel =
    session.proofMode === "operator_observed"
      ? "operator observation"
      : session.proofMode === "client_settlement_proof"
        ? "settlement proof"
        : session.proofMode === "client_tx_ref"
          ? "tx reference"
          : "session record";
  const targetMeta = [session.target.network, session.target.reference ? `ref ${shortenText(session.target.reference, { head: 10, tail: 6 })}` : null]
    .filter(Boolean)
    .join(" · ");
  const settlementRef = session.settlement?.settlementRef
    ? shortenText(session.settlement.settlementRef, { head: 12, tail: 8 })
    : null;
  const createdAt = formatSessionTimestamp(session.createdAtMs);
  const nativeSendFailed = nativeState?.ok === false && !!nativeState.message;

  const paymentState: PaymentTimelineStepState =
    nativeSendFailed || (terminalError && !paymentSubmitted)
      ? "error"
      : paymentSubmitted
        ? "done"
        : session.status === "awaiting_payment" || session.status === "pending_operator" || nativeState?.ok
          ? "active"
          : "waiting";
  const operatorState: PaymentTimelineStepState =
    terminalError
      ? "error"
      : verifiedOrGranted || session.status === "observed"
        ? "done"
        : session.status === "pending_operator"
          ? "active"
          : "waiting";
  const unlockState: PaymentTimelineStepState =
    session.status === "granted"
      ? "done"
      : terminalError
        ? "error"
        : session.status === "verified"
          ? "active"
          : "waiting";

  return [
    {
      id: "session",
      label: "Session",
      detail: `Created${createdAt ? ` ${createdAt}` : ""}`,
      state: "done",
      meta: formatSessionExpiry(session)
    },
    {
      id: "target",
      label: "Payment target",
      detail: hasTarget
        ? `${session.target.targetType === "invoice" ? "Invoice" : session.target.targetType === "uri" ? "URI" : "Address"} allocated`
        : "Waiting for target allocation",
      state: hasTarget ? "done" : terminalError ? "error" : "active",
      meta: targetMeta || session.operator.label || null
    },
    {
      id: "payment",
      label: "Wallet/proof",
      detail: submittedTxRef
        ? `Submitted ${shortenText(submittedTxRef, { head: 12, tail: 8 })}`
        : nativeState?.message
          ? nativeState.message
          : session.status === "pending_operator"
            ? "Payment sent; waiting for operator observation"
            : `Awaiting ${proofLabel}`,
      state: paymentState,
      meta: nativeSendFailed ? "wallet did not confirm send" : null
    },
    {
      id: "operator",
      label: "Verifier",
      detail: session.settlement
        ? `Verified ${session.settlement.settlementKind}${settlementRef ? ` ${settlementRef}` : ""}`
        : terminalError
          ? session.error || formatPaymentSessionStatus(session.status)
          : session.status === "pending_operator"
            ? "Operator is checking the rail"
            : `Waiting for ${proofLabel}`,
      state: operatorState,
      meta: formatSessionTimestamp(session.settlement?.observedAtMs) ?? session.operator.label ?? null
    },
    {
      id: "unlock",
      label: "Access",
      detail:
        session.status === "granted"
          ? "Archive access granted"
          : terminalError
            ? session.error || formatPaymentSessionStatus(session.status)
            : session.status === "verified"
              ? "Issuing archive access grant"
              : "Waiting for verified settlement",
      state: unlockState,
      meta: session.entitlementId ? `entitlement ${shortenText(session.entitlementId, { head: 10, tail: 6 })}` : null
    }
  ];
}

function PaymentSessionTimeline({
  session,
  hasTarget,
  nativeState
}: {
  session: VideoPackagePaymentSession;
  hasTarget: boolean;
  nativeState?: NativeSendStatus;
}) {
  const steps = buildPaymentTimelineSteps({ session, hasTarget, nativeState });
  const updatedAt = formatSessionTimestamp(session.updatedAtMs);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
        <span>Payment timeline</span>
        {updatedAt ? <span>updated {updatedAt}</span> : null}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        {steps.map((step) => (
          <div key={step.id} className={`rounded-lg border px-2.5 py-2 ${paymentTimelineStateClass(step.state)}`}>
            <div className="flex items-start gap-2">
              {paymentTimelineIcon(step.state)}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold">{step.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug opacity-90">{step.detail}</div>
                {step.meta ? <div className="mt-1 truncate text-[10px] opacity-65">{step.meta}</div> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function targetTypeLabel(targetType: PaymentTargetType | undefined): string {
  if (targetType === "invoice") return "invoice";
  if (targetType === "uri") return "payment URI";
  return "address";
}

function copyTargetLabel(targetType: PaymentTargetType | undefined): string {
  return `Copy ${targetTypeLabel(targetType)}`;
}

function railBuyerWalletHint(railId: PaymentRailId, assetSymbol: string): string {
  if (railId === "xmr") {
    return "Send from a Monero wallet to the unique session subaddress. The operator watches wallet-rpc and unlocks after confirmed settlement.";
  }
  if (railId === "lightning") {
    return "Pay the Lightning invoice or zap target. The operator watches the session-bound receipt and unlocks when the receipt verifies.";
  }
  if (railId === "evm") {
    return "Use MetaMask when available, or open/copy the wallet target. The operator verifies the exact session amount on the configured EVM chain.";
  }
  if (railId === "solana") {
    return "Use Phantom when available, or open/copy the wallet target. The operator verifies the exact session amount on Solana.";
  }
  if (railId === "tron") {
    return "Use TronLink when available, or open/copy the wallet target. The operator verifies the exact session amount on TRON.";
  }
  if (railId === "utxo") {
    return `Pay from a ${assetSymbol} wallet using the exact session amount. The operator watches outputs for this session scope.`;
  }
  if (railId === "xrpl") {
    return "Pay with the destination tag/reference intact. The operator verifies the validated XRPL payment for this session.";
  }
  if (railId === "cardano") {
    return "Pay from a Cardano wallet using the exact session amount. The operator verifies the matching UTXO through the configured provider.";
  }
  return `Pay from a ${assetSymbol} wallet using the exact target and amount.`;
}

function proofModeBuyerHint(session: VideoPackagePaymentSession | null | undefined): string {
  if (!session) return "Start a session first so the operator can allocate a session-specific target.";
  if (session.proofMode === "operator_observed") {
    return "Normal completion is automatic: send the payment, then let the operator poll and grant access.";
  }
  if (session.proofMode === "client_tx_ref") {
    return "If the wallet returns a transaction id, dStream submits it to the verifier. Paste manually only if the wallet cannot return it.";
  }
  if (session.proofMode === "client_settlement_proof") {
    return "If the wallet/provider returns a signed proof, dStream submits it to the verifier. Paste manually only as fallback.";
  }
  return "This session records payment state, but no automatic proof mode is configured.";
}

function buyerWalletActionTitle(input: {
  nativeCapability: NativeWalletCapability | null;
  providerLabel: string;
  preferredWalletName?: string | null;
  assetSymbol: string;
}): string {
  const { nativeCapability, providerLabel, preferredWalletName, assetSymbol } = input;
  if (nativeCapability?.mode === "provider_send") return `Use ${providerLabel}`;
  if (nativeCapability?.mode === "wallet_uri") return `Open ${preferredWalletName ?? "wallet app"}`;
  return `Pay with your ${assetSymbol} wallet`;
}

function buyerWalletActionDetail(input: {
  nativeCapability: NativeWalletCapability | null;
  providerLabel: string;
  preferredWalletName?: string | null;
  walletUri: string | null;
  nativeNeedsAmount: boolean;
  nativeAmount: string;
  railId: PaymentRailId;
  assetSymbol: string;
}): string {
  const { nativeCapability, providerLabel, preferredWalletName, walletUri, nativeNeedsAmount, nativeAmount, railId, assetSymbol } = input;
  if (nativeNeedsAmount && !nativeAmount) {
    return `Enter the exact ${assetSymbol} amount before using the in-browser wallet send. Copy/open fallback remains available.`;
  }
  if (nativeCapability?.mode === "provider_send") {
    return `The browser detected ${providerLabel}. Use it for the primary send path; returned tx/proof data is attached to this session when the wallet provides it.`;
  }
  if (nativeCapability?.mode === "wallet_uri" || walletUri) {
    return `Open ${preferredWalletName ?? "a wallet app"} with the session URI. If the app does not return a tx id, the operator still watches the session target.`;
  }
  if (nativeCapability?.reason) return nativeCapability.reason;
  return railBuyerWalletHint(railId, assetSymbol);
}

function BuyerWalletActionCard({
  railId,
  assetSymbol,
  method,
  session,
  nativeCapability,
  nativeNeedsAmount,
  nativeAmount,
  providerLabel,
  walletUri,
  preferredWalletName
}: {
  railId: PaymentRailId;
  assetSymbol: string;
  method: StreamPaymentMethod;
  session?: VideoPackagePaymentSession | null;
  nativeCapability: NativeWalletCapability | null;
  nativeNeedsAmount: boolean;
  nativeAmount: string;
  providerLabel: string;
  walletUri: string | null;
  preferredWalletName?: string | null;
}) {
  const amountLabel = nativeAmount || method.amount?.trim() || session?.target.amount || "";
  const networkLabel = method.network ?? session?.target.network ?? railId;
  const referenceLabel = session?.target.reference ? shortenText(session.target.reference, { head: 12, tail: 6 }) : null;
  const waitingForAmount = nativeNeedsAmount && !nativeAmount;
  const badge =
    waitingForAmount
      ? "Amount needed"
      : nativeCapability?.mode === "provider_send"
        ? "Provider detected"
        : nativeCapability?.mode === "wallet_uri" || walletUri
          ? "Wallet URI"
          : "Copy/manual wallet";
  const badgeClass =
    waitingForAmount
      ? "border-amber-700/50 bg-amber-950/30 text-amber-200"
      : nativeCapability?.supported || walletUri
        ? "border-emerald-700/50 bg-emerald-950/25 text-emerald-200"
        : "border-neutral-700 bg-neutral-900 text-neutral-300";
  const metaItems = [
    amountLabel ? `Exact amount ${amountLabel} ${assetSymbol}` : `Enter exact amount in ${assetSymbol}`,
    `Network ${networkLabel}`,
    `${targetTypeLabel(session?.target.targetType)} target`,
    referenceLabel ? `Ref ${referenceLabel}` : null,
    session?.proofMode ? `Verifier ${session.proofMode.replace(/_/g, " ")}` : null
  ].filter((item): item is string => !!item);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/35 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Recommended wallet action</div>
          <div className="mt-1 text-sm font-semibold text-neutral-100">
            {buyerWalletActionTitle({ nativeCapability, providerLabel, preferredWalletName, assetSymbol })}
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>{badge}</span>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-neutral-300">
        {buyerWalletActionDetail({
          nativeCapability,
          providerLabel,
          preferredWalletName,
          walletUri,
          nativeNeedsAmount,
          nativeAmount,
          railId,
          assetSymbol
        })}
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-neutral-500">{railBuyerWalletHint(railId, assetSymbol)}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {metaItems.map((item) => (
          <span key={item} className="rounded-full border border-neutral-800 bg-neutral-900/70 px-2 py-0.5 text-[10px] text-neutral-300">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-blue-200">{proofModeBuyerHint(session)}</div>
    </div>
  );
}

function settlementProofLabel(row: VideoAccessPackage, session?: VideoPackagePaymentSession | null): string {
  if (session?.proofMode === "client_settlement_proof") return "Paste signed settlement proof";
  if (session?.proofMode === "client_tx_ref") return "Paste transaction hash / signature";
  const railId = session?.railId ?? row.paymentTarget?.railId ?? row.paymentRailId ?? getPaymentRailForAsset(row.paymentAsset).id;
  if (railId === "lightning") return "Paste signed zap receipt JSON";
  return "Paste transaction hash / signature";
}

function buildSettlementProof(
  row: VideoAccessPackage,
  proofDraft: string,
  session?: VideoPackagePaymentSession | null
): PaymentSettlementProof {
  const railId = (session?.railId ??
    row.paymentTarget?.railId ??
    row.paymentRailId ??
    getPaymentRailForAsset(row.paymentAsset).id) as PaymentRailId;
  const proofValue = proofDraft.trim();
  if (!proofValue) {
    throw new Error(railId === "lightning" ? "Paste the signed zap receipt JSON first." : "Paste the transaction reference first.");
  }
  if (railId === "lightning") {
    let receiptEvent: unknown;
    try {
      receiptEvent = JSON.parse(proofValue);
    } catch {
      throw new Error("Lightning verification requires the full signed zap receipt JSON.");
    }
    return {
      version: 1,
      railId: "lightning",
      asset: "btc",
      proofType: "nip57_zap_receipt",
      payload: { receiptEvent }
    };
  }
  return {
    version: 1,
    railId,
    asset: row.paymentAsset,
    proofType: "transaction_reference",
    txRef: proofValue,
    network: session?.target.network ?? row.paymentTarget?.network,
    payload: {
      txRef: proofValue,
      network: session?.target.network ?? row.paymentTarget?.network
    }
  };
}

export function VideoPackageUnlockPanel({
  hostPubkey,
  streamId,
  originStreamId,
  accessError,
  accessBusy,
  onPlaybackAccessRequested
}: VideoPackageUnlockPanelProps) {
  const { identity, signEvent } = useIdentity();
  const social = useSocial();
  const [packages, setPackages] = useState<VideoAccessPackage[]>([]);
  const [unlocksByPackageId, setUnlocksByPackageId] = useState<Record<string, VideoPackageViewerUnlock>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseBusyId, setPurchaseBusyId] = useState<string | null>(null);
  const [sessionByPackageId, setSessionByPackageId] = useState<Record<string, VideoPackagePaymentSession>>({});
  const [buyerProofByPackageId, setBuyerProofByPackageId] = useState<Record<string, NostrEvent>>({});
  const [proofDraftByPackageId, setProofDraftByPackageId] = useState<Record<string, string>>({});
  const [copyStateByKey, setCopyStateByKey] = useState<Record<string, "idle" | "copied" | "error">>({});
  const [nativeSendBusyByKey, setNativeSendBusyByKey] = useState<Record<string, boolean>>({});
  const [nativeSendAmountByKey, setNativeSendAmountByKey] = useState<Record<string, string>>({});
  const [nativeSendStatusByKey, setNativeSendStatusByKey] = useState<Record<string, NativeSendStatus>>({});

  const loadPackages = useCallback(async () => {
    if (!hostPubkey || !streamId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listVideoAccessPackagesClient({
        hostPubkey,
        streamId,
        includeDisabled: false,
        includeUnlisted: false,
        limit: 64
      });
      setPackages(result.packages.filter((row) => row.status === "active"));
    } catch (error: any) {
      setLoadError(error?.message ?? "Failed to load archive packages.");
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, [hostPubkey, streamId]);

  const loadViewerUnlocks = useCallback(async () => {
    if (!hostPubkey || !streamId || !identity?.pubkey) {
      setUnlocksByPackageId({});
      return;
    }
    const viewerProof = await buildAccessViewerProof(signEvent, identity.pubkey, hostPubkey);
    if (!viewerProof) throw new Error("Connect an identity to load archive unlocks.");
    const result = await listVideoPackageViewerStatusClient({
      hostPubkey,
      streamId,
      viewerProofEvent: viewerProof
    });
    setUnlocksByPackageId(result.byPackageId);
  }, [hostPubkey, identity?.pubkey, signEvent, streamId]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    void loadViewerUnlocks().catch((error: any) => {
      if (!identity?.pubkey) return;
      setLoadError(error?.message ?? "Failed to load viewer unlock state.");
    });
  }, [identity?.pubkey, loadViewerUnlocks]);

  useEffect(() => {
    setProofDraftByPackageId({});
    setSessionByPackageId({});
    setBuyerProofByPackageId({});
    setPurchaseBusyId(null);
    setPurchaseError(null);
    setNotice(null);
  }, [identity?.pubkey, originStreamId]);

  const copyValue = useCallback(async (key: string, value: string) => {
    setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(value);
      setCopyStateByKey((prev) => ({ ...prev, [key]: "copied" }));
      window.setTimeout(() => {
        setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
      }, 1200);
    } catch {
      setCopyStateByKey((prev) => ({ ...prev, [key]: "error" }));
      window.setTimeout(() => {
        setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
      }, 1500);
    }
  }, []);

  const ensureBuyerProof = useCallback(
    async (row: VideoAccessPackage): Promise<NostrEvent> => {
      if (!identity?.pubkey) throw new Error("Connect an identity to unlock private archive packages.");
      const existing = buyerProofByPackageId[row.id];
      if (existing) return existing;
      const buyerProof = await buildAccessPurchaseProof(signEvent, identity.pubkey, {
        hostPubkey: row.hostPubkey,
        packageId: row.id,
        ttlSec: 60 * 60
      });
      if (!buyerProof) throw new Error("Failed to sign the package purchase proof.");
      setBuyerProofByPackageId((prev) => ({ ...prev, [row.id]: buyerProof }));
      return buyerProof;
    },
    [buyerProofByPackageId, identity?.pubkey, signEvent]
  );

  const buildSessionCreateMetadata = useCallback(
    async (row: VideoAccessPackage, sessionId: string, origin: string): Promise<Record<string, unknown>> => {
      const metadata: Record<string, unknown> = {
        origin,
        streamId: row.streamId
      };
      const railId = (row.paymentTarget?.railId ?? row.paymentRailId ?? getPaymentRailForAsset(row.paymentAsset).id) as PaymentRailId;
      if (railId !== "lightning") return metadata;
      if (!identity?.pubkey) throw new Error("Connect an identity to start a Lightning payment session.");
      const amountSats = parseBtcAmountToSats((row.paymentTarget?.amount ?? row.paymentAmount ?? "").trim());
      if (!amountSats) throw new Error("Lightning package amount is invalid.");
      const relays = getNostrRelays();
      const signedZapRequest = await signEvent(
        buildZapRequestUnsigned({
          senderPubkey: identity.pubkey,
          recipientPubkey: row.hostPubkey,
          streamId: row.streamId,
          amountSats,
          relays,
          packageId: row.id,
          sessionId
        }) as any
      );
      return {
        ...metadata,
        lightningZapRequestEvent: signedZapRequest,
        lightningZapRequestId: signedZapRequest.id,
        lightningZapRequestRelays: relays
      };
    },
    [identity?.pubkey, signEvent]
  );

  const applySessionUpdate = useCallback(
    async (row: VideoAccessPackage, session: VideoPackagePaymentSession, successPrefix?: string) => {
      const previous = sessionByPackageId[row.id];
      setSessionByPackageId((prev) => ({ ...prev, [row.id]: session }));
      if (previous?.status !== "granted" && session.status === "granted") {
        await loadViewerUnlocks();
        await onPlaybackAccessRequested();
        setNotice(
          `${successPrefix ?? `Unlocked ${row.title}`}${session.settlement?.settlementRef ? ` · ${shortenText(session.settlement.settlementRef, { head: 18, tail: 10 })}` : ""}.`
        );
      }
    },
    [loadViewerUnlocks, onPlaybackAccessRequested, sessionByPackageId]
  );

  const refreshPaymentSession = useCallback(
    async (row: VideoAccessPackage, sessionId: string) => {
      const result = await getVideoPackagePaymentSessionStatusClient({ sessionId });
      await applySessionUpdate(row, result.session);
      return result.session;
    },
    [applySessionUpdate]
  );

  const sendNativePayment = useCallback(
    async (row: VideoAccessPackage, method: StreamPaymentMethod, session?: VideoPackagePaymentSession | null) => {
      const railId = session?.railId ?? row.paymentTarget?.railId ?? row.paymentRailId ?? getPaymentRailForAsset(row.paymentAsset).id;
      const key = `${row.id}:${method.asset}:${method.network ?? ""}:${method.address}`;
      const amountDraft = (nativeSendAmountByKey[key] ?? "").trim();
      const requestMethod: StreamPaymentMethod = {
        ...method,
        amount: (method.amount ?? "").trim() || amountDraft || undefined
      };

      setNativeSendBusyByKey((prev) => ({ ...prev, [key]: true }));
      setNativeSendStatusByKey((prev) => ({ ...prev, [key]: { ok: false, message: "" } }));
      try {
        const result = await sendNativeWalletPayment(requestMethod);
        if (!result.ok) {
          setNativeSendStatusByKey((prev) => ({
            ...prev,
            [key]: { ok: false, message: result.error ?? "Wallet send failed." }
          }));
          return;
        }
        if (result.txId && railId !== "lightning") {
          setProofDraftByPackageId((prev) => ({
            ...prev,
            [row.id]: result.txId ?? prev[row.id] ?? ""
          }));
        }
        if (session && result.txId) {
          const buyerProof = await ensureBuyerProof(row);
          const observed = await observeVideoPackagePaymentSessionClient({
            sessionId: session.id,
            buyerProofEvent: buyerProof,
            txRef: result.txId,
            metadata: {
              origin: "watch_native_wallet_send",
              provider: result.provider ?? "wallet"
            }
          });
          await applySessionUpdate(row, observed.session, `Unlocked ${row.title} via payment session`);
        } else if (session && session.proofMode === "operator_observed") {
          window.setTimeout(() => {
            void refreshPaymentSession(row, session.id).catch(() => {});
          }, 2000);
        }
        setNativeSendStatusByKey((prev) => ({
          ...prev,
          [key]: {
            ok: true,
            message:
              session?.proofMode === "operator_observed"
                ? "Wallet payment initiated. Waiting for operator verification."
                : railId === "lightning"
                  ? "Wallet payment initiated. If the operator does not report settlement, use the emergency proof fallback."
                  : result.provider === "wallet_uri"
                    ? "Opened wallet app. If your wallet returns a tx hash, the session will use it automatically."
                    : `Submitted via ${result.provider ?? "wallet"}.`,
            txId: session?.proofMode === "operator_observed" && railId === "lightning" ? undefined : result.txId
          }
        }));
      } catch (error: any) {
        setNativeSendStatusByKey((prev) => ({
          ...prev,
          [key]: { ok: false, message: error?.message ?? "Wallet send failed." }
        }));
      } finally {
        setNativeSendBusyByKey((prev) => ({ ...prev, [key]: false }));
      }
    },
    [applySessionUpdate, ensureBuyerProof, nativeSendAmountByKey, refreshPaymentSession]
  );

  const handlePurchase = useCallback(
    async (row: VideoAccessPackage) => {
      if (!identity?.pubkey) {
        setPurchaseError("Connect an identity to unlock private archive packages.");
        return;
      }
      setNotice(null);
      setPurchaseError(null);
      setPurchaseBusyId(row.id);
      try {
        const existingSession = sessionByPackageId[row.id];
        if (existingSession && !isTerminalSession(existingSession.status)) {
          await refreshPaymentSession(row, existingSession.id);
          return;
        }
        const buyerProof = await ensureBuyerProof(row);
        const requestedSessionId = crypto.randomUUID();
        const result = await createVideoPackagePaymentSessionClient({
          packageId: row.id,
          sessionId: requestedSessionId,
          buyerProofEvent: buyerProof,
          metadata: await buildSessionCreateMetadata(row, requestedSessionId, "watch_private_archive_unlock")
        });
        await applySessionUpdate(row, result.session, `Unlocked ${row.title} via payment session`);
        if (result.session.status !== "granted") {
          setNotice(`Started ${row.title} payment session · ${formatPaymentSessionStatus(result.session.status).toLowerCase()}.`);
        }
      } catch (error: any) {
        setPurchaseError(error?.message ?? "Failed to start a payment session.");
      } finally {
        setPurchaseBusyId(null);
      }
    },
    [applySessionUpdate, buildSessionCreateMetadata, ensureBuyerProof, identity?.pubkey, refreshPaymentSession, sessionByPackageId]
  );

  const submitManualFallback = useCallback(
    async (row: VideoAccessPackage) => {
      if (!identity?.pubkey) {
        setPurchaseError("Connect an identity to unlock private archive packages.");
        return;
      }
      setNotice(null);
      setPurchaseError(null);
      setPurchaseBusyId(row.id);
      try {
        const buyerProof = await ensureBuyerProof(row);
        const existingSession = sessionByPackageId[row.id];
        const session =
          existingSession ??
          (
            await createVideoPackagePaymentSessionClient({
              packageId: row.id,
              buyerProofEvent: buyerProof,
              metadata: {
                origin: "watch_private_archive_unlock_manual_fallback",
                streamId: row.streamId
              }
            })
          ).session;
        const settlementProof = buildSettlementProof(row, proofDraftByPackageId[row.id] ?? "", session);
        const observed = await observeVideoPackagePaymentSessionClient({
          sessionId: session.id,
          buyerProofEvent: buyerProof,
          settlementProof,
          metadata: {
            origin: "watch_manual_session_fallback",
            streamId: row.streamId
          }
        });
        await applySessionUpdate(row, observed.session, `Unlocked ${row.title} via payment session`);
      } catch (error: any) {
        setPurchaseError(error?.message ?? "Failed to verify this payment session.");
      } finally {
        setPurchaseBusyId(null);
      }
    },
    [applySessionUpdate, ensureBuyerProof, identity?.pubkey, proofDraftByPackageId, sessionByPackageId]
  );

  useEffect(() => {
    const pendingSessions = packages
      .map((row) => ({ row, session: sessionByPackageId[row.id] }))
      .filter(({ session }) => !!session && !isTerminalSession(session.status));
    if (pendingSessions.length === 0) return;
    const timer = window.setInterval(() => {
      for (const { row, session } of pendingSessions) {
        if (!session) continue;
        void refreshPaymentSession(row, session.id).catch(() => {});
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [packages, refreshPaymentSession, sessionByPackageId]);

  const packageRows = useMemo(
    () =>
      packages.map((row) => {
        const session = sessionByPackageId[row.id];
        const sessionConfig = readVideoPackagePaymentSessionConfig(row);
        const method = session ? paymentSessionTargetToMethod(session.target) : paymentSettlementTargetToMethod(row.paymentTarget, row.paymentAmount);
        return {
          row,
          session,
          sessionConfig,
          method,
          unlock: unlocksByPackageId[row.id]
        };
      }),
    [packages, sessionByPackageId, unlocksByPackageId]
  );

  return (
    <div className="rounded-2xl border border-blue-700/40 bg-blue-950/15 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-blue-200 uppercase tracking-wider font-bold">Private Archive Access</div>
          <div className="mt-1 text-sm text-neutral-200">
            Verified purchases unlock the archive through the same settlement contract the backend enforces.
          </div>
        </div>
        <div className="text-xs text-neutral-500">{accessBusy ? "Checking access…" : "Verifier-backed packages"}</div>
      </div>

      {notice && <div className="text-xs text-emerald-300">{notice}</div>}
      {purchaseError && <div className="text-xs text-red-300">{purchaseError}</div>}
      {accessError && <div className="text-xs text-red-300">{accessError}</div>}
      {loadError && <div className="text-xs text-red-300">{loadError}</div>}

      {!identity?.pubkey && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-300">
          Connect a Nostr identity first. Archive playback tokens and verified package receipts are bound to the viewer pubkey.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-neutral-400">Loading package offers…</div>
      ) : packageRows.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-sm text-neutral-400">
          No verified archive packages are configured for this stream yet.
        </div>
      ) : (
        <div className="space-y-3">
          {packageRows.map(({ row, session, sessionConfig, method, unlock }) => {
            const paymentKey = `${row.id}:${method?.asset ?? row.paymentAsset}:${method?.network ?? ""}:${method?.address ?? row.id}`;
            const copyState = copyStateByKey[paymentKey] ?? "idle";
            const nativeState = nativeSendStatusByKey[paymentKey];
            const nativeBusy = !!nativeSendBusyByKey[paymentKey];
            const nativeAmountDraft = nativeSendAmountByKey[paymentKey] ?? "";
            const nativeCapability = method ? getNativeWalletCapability(method) : null;
            const nativeSupported = !!(method && nativeCapability?.supported && supportsNativeWalletPayment(method));
            const nativeNeedsAmount = !!(method && nativeCapability?.requiresAmount && nativeWalletSendNeedsAmount(method));
            const nativeAmount = method ? (method.amount ?? "").trim() || nativeAmountDraft.trim() : "";
            const canNativeSend = !!method && nativeSupported && (!nativeNeedsAmount || !!nativeAmount);
            const providerLabel = method && nativeCapability ? nativeCapability.providerLabel || nativeWalletProviderLabel(method) : "wallet";
            const walletUri = session?.target.walletUri ?? (method ? buildPaymentUri(method) : null);
            const preferredWalletId = social.settings.paymentDefaults.preferredWalletByAsset[row.paymentAsset] ?? null;
            const preferredWallet = getWalletIntegrationById(preferredWalletId);
            const unlockExpiry = formatUnlockExpiry(unlock);
            const assetMeta = PAYMENT_ASSET_META[row.paymentAsset];
            const railId = session?.railId ?? row.paymentTarget?.railId ?? row.paymentRailId ?? getPaymentRailForAsset(row.paymentAsset).id;
            const manualFallbackVisible = !!session && (session.proofMode === "client_tx_ref" || session.proofMode === "client_settlement_proof");
            const canStartSession = !!identity?.pubkey && purchaseBusyId !== row.id && (!!session || sessionConfig.enabled);
            const sessionAllocationHint =
              session?.status === "pending_operator" && !method
                ? "Waiting for the payment operator to allocate the session target."
                : sessionConfig.transport === "http"
                  ? "The host payment operator will allocate the payment target when this session starts."
                  : railId === "xmr"
                    ? "A unique Monero subaddress will be allocated when this session starts."
                    : "The payment target will be allocated when this session starts.";
            return (
              <div key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">{row.title}</div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {row.paymentAmount} {assetMeta.symbol} · {formatDurationHours(row.durationHours)} · {railId}
                    </div>
                    {row.description ? <div className="mt-1 text-xs text-neutral-400">{row.description}</div> : null}
                    {unlockExpiry ? <div className="mt-1 text-xs text-emerald-300">Active unlock until {unlockExpiry}</div> : null}
                    {session ? (
                      <div className={`mt-1 text-xs ${session.status === "granted" ? "text-emerald-300" : session.status === "failed" || session.status === "expired" ? "text-red-300" : "text-blue-200"}`}>
                        {formatPaymentSessionStatus(session.status)}
                        {session.operator.label ? ` · ${session.operator.label}` : ""}
                      </div>
                    ) : sessionConfig.enabled ? (
                      <div className="mt-1 text-xs text-neutral-500">
                        Session authority: {sessionConfig.operatorEndpoint ? sessionConfig.operatorLabel || "node operator" : "embedded reference"}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePurchase(row)}
                    disabled={!canStartSession}
                    className="px-3 py-1.5 rounded-lg bg-blue-900/40 hover:bg-blue-900/55 border border-blue-700/50 text-xs text-blue-100 disabled:opacity-50"
                  >
                    {purchaseBusyId === row.id
                      ? "Working…"
                      : session && !isTerminalSession(session.status)
                        ? "Refresh session"
                        : unlock
                          ? "Refresh unlock"
                          : "Start payment session"}
                  </button>
                </div>

                {session ? <PaymentSessionTimeline session={session} hasTarget={!!method} nativeState={nativeState} /> : null}

                {method ? (
                  <div className="space-y-2">
                    <BuyerWalletActionCard
                      railId={railId}
                      assetSymbol={assetMeta.symbol}
                      method={method}
                      session={session}
                      nativeCapability={nativeCapability}
                      nativeNeedsAmount={nativeNeedsAmount}
                      nativeAmount={nativeAmount}
                      providerLabel={providerLabel}
                      walletUri={walletUri}
                      preferredWalletName={preferredWallet?.name}
                    />
                    <div className="text-xs text-neutral-500">
                      {session ? "Session target:" : "Settlement target:"}{" "}
                      <span className="font-mono text-neutral-300 break-all">{method.address}</span>
                    </div>
                    {session?.target.reference ? (
                      <div className="text-[11px] text-neutral-500">
                        Reference: <span className="font-mono text-neutral-300 break-all">{session.target.reference}</span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyValue(paymentKey, method.address)}
                        className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {copyState === "copied" ? "Copied" : copyState === "error" ? "Error" : copyTargetLabel(session?.target.targetType)}
                      </button>
                      {walletUri && (
                        <a
                          href={walletUri}
                          className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {preferredWallet ? `Open ${preferredWallet.name}` : "Open wallet"}
                        </a>
                      )}
                      {method && (
                        <button
                          type="button"
                          onClick={() => void sendNativePayment(row, method, session)}
                          disabled={!canNativeSend || nativeBusy}
                          className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                          title={
                            nativeSupported
                              ? nativeCapability?.mode === "wallet_uri"
                                ? "Open wallet using payment URI"
                                : `Send with ${providerLabel}`
                              : nativeCapability?.reason ?? `${providerLabel} not detected in this browser`
                          }
                        >
                          {nativeBusy
                            ? "Sending…"
                            : nativeCapability?.mode === "wallet_uri"
                              ? "Open wallet app"
                              : `Send via ${providerLabel}`}
                        </button>
                      )}
                    </div>
                    {nativeNeedsAmount && !(method.amount ?? "").trim() && (
                      <input
                        value={nativeAmountDraft}
                        onChange={(event) =>
                          setNativeSendAmountByKey((prev) => ({
                            ...prev,
                            [paymentKey]: event.target.value
                          }))
                        }
                        placeholder={`Amount (${assetMeta.symbol})`}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                      />
                    )}
                    {nativeState?.message ? (
                      <div className={`text-[11px] ${nativeState.ok ? "text-emerald-300" : "text-red-300"}`}>
                        {nativeState.message}
                        {nativeState.txId ? (
                          <>
                            {" "}
                            · tx <span className="font-mono text-neutral-300">{shortenText(nativeState.txId, { head: 12, tail: 8 })}</span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {session?.error ? <div className="text-[11px] text-red-300">{session.error}</div> : null}
                  </div>
                ) : sessionConfig.enabled ? (
                  <div className="text-xs text-blue-200">{sessionAllocationHint}</div>
                ) : (
                  <div className="text-xs text-amber-300">
                    This package does not have a usable verified settlement target yet. The host needs to finish the payment target or operator configuration.
                  </div>
                )}

                {manualFallbackVisible ? (
                  <details className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] text-neutral-400">Emergency proof fallback</summary>
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={proofDraftByPackageId[row.id] ?? ""}
                        onChange={(event) =>
                          setProofDraftByPackageId((prev) => ({
                            ...prev,
                            [row.id]: event.target.value
                          }))
                        }
                        rows={railId === "lightning" ? 5 : 2}
                        placeholder={settlementProofLabel(row, session)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] text-neutral-500">
                          {session?.proofMode === "client_settlement_proof"
                            ? "Use this only if the operator could not observe Lightning settlement automatically."
                            : "Use this only if your wallet did not return a transaction hash automatically."}
                        </div>
                        <button
                          type="button"
                          onClick={() => void submitManualFallback(row)}
                          disabled={purchaseBusyId === row.id}
                          className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200 disabled:opacity-50"
                        >
                          {purchaseBusyId === row.id ? "Submitting…" : "Submit fallback proof"}
                        </button>
                      </div>
                    </div>
                  </details>
                ) : session?.proofMode === "operator_observed" ? (
                  <div className="text-[11px] text-neutral-500">
                    This session is operator-observed. The normal flow is wallet send plus operator status polling, not manual proof entry.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
