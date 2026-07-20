"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, LoaderCircle, RefreshCw, ShieldCheck, Wallet, X, Zap } from "lucide-react";
import type { StreamPaymentMethod } from "@dstream/protocol";
import { makeATag } from "@dstream/protocol";
import { TipDialog as MoneroTipDialog } from "@/components/monero/TipDialog";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import type { NostrProfile } from "@/lib/profile";
import { PAYMENT_ASSET_META } from "@/lib/payments/catalog";
import { requestLightningZapInvoice } from "@/lib/payments/lightning";
import { payLightningInvoice } from "@/lib/payments/lightningWallet";
import { getNativeWalletCapability, sendNativeWalletPayment } from "@/lib/payments/nativeWallet";
import {
  buildPaymentIntentProof,
  capabilityForMethod,
  createTipPaymentIntent,
  loadPaymentRailCapabilities,
  paymentMethodFromIntent,
  verifyPaymentIntent,
  verifyPaymentIntentWithPolling,
  waitForLightningZapReceipt,
  type ClientPaymentRailCapability,
  type PaymentIntentCredentials
} from "@/lib/payments/paymentIntents";
import { getPaymentRailForMethod } from "@/lib/payments/rails";

interface UnifiedTipDialogProps {
  open: boolean;
  streamPubkey: string;
  streamId: string;
  broadcasterName?: string;
  paymentMethods?: StreamPaymentMethod[];
  onClose: () => void;
}

type PaymentPhase = "idle" | "wallet" | "confirming" | "reference" | "verified" | "error";

interface PaymentStatus {
  phase: PaymentPhase;
  message: string;
}

interface PendingLightningPayment {
  credentials: PaymentIntentCredentials;
  invoice: string;
  zapRequestJson: string;
  providerPubkey: string;
  createdAtSec: number;
  preimage?: string;
}

function methodKey(method: StreamPaymentMethod): string {
  return `${method.asset}:${method.network ?? ""}:${method.address}`;
}

function isLightningMethod(method: StreamPaymentMethod): boolean {
  return getPaymentRailForMethod(method).id === "lightning";
}

function profilePaymentMethods(profile: NostrProfile | null | undefined): StreamPaymentMethod[] {
  if (!profile) return [];
  const candidates: Array<StreamPaymentMethod | null> = [
    profile.lud16 || profile.lud06
      ? { asset: "btc", network: "lightning", address: (profile.lud16 || profile.lud06)!, label: "Lightning" }
      : null,
    profile.xmr ? { asset: "xmr", network: "mainnet", address: profile.xmr, label: "Monero" } : null,
    profile.btc ? { asset: "btc", network: "bitcoin", address: profile.btc, label: "Bitcoin" } : null,
    profile.eth ? { asset: "eth", network: "ethereum", address: profile.eth, label: "Ethereum" } : null,
    profile.trx ? { asset: "trx", network: "tron", address: profile.trx, label: "TRON" } : null,
    profile.sol ? { asset: "sol", network: "solana", address: profile.sol, label: "Solana" } : null,
    profile.xrp ? { asset: "xrp", network: "xrpl", address: profile.xrp, label: "XRP" } : null,
    profile.ada ? { asset: "ada", network: "cardano", address: profile.ada, label: "Cardano" } : null,
    profile.doge ? { asset: "doge", network: "dogecoin", address: profile.doge, label: "Dogecoin" } : null
  ];
  return candidates.filter((method): method is StreamPaymentMethod => !!method);
}

export function UnifiedTipDialog({
  open,
  streamPubkey,
  streamId,
  broadcasterName,
  paymentMethods = [],
  onClose
}: UnifiedTipDialogProps) {
  const profile = useNostrProfile(streamPubkey)?.profile;
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const [showMonero, setShowMonero] = useState(false);
  const [amountByKey, setAmountByKey] = useState<Record<string, string>>({});
  const [referenceByKey, setReferenceByKey] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, PaymentStatus>>({});
  const [pendingByKey, setPendingByKey] = useState<Record<string, PaymentIntentCredentials>>({});
  const [pendingLightningByKey, setPendingLightningByKey] = useState<Record<string, PendingLightningPayment>>({});
  const [capabilities, setCapabilities] = useState<ClientPaymentRailCapability[] | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const methods = useMemo(() => {
    const dedup = new Map<string, StreamPaymentMethod>();
    for (const method of [...paymentMethods, ...profilePaymentMethods(profile)]) {
      const key = methodKey(method);
      if (!dedup.has(key)) dedup.set(key, method);
    }
    return Array.from(dedup.values());
  }, [paymentMethods, profile]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCapabilityError("");
    void loadPaymentRailCapabilities()
      .then((next) => {
        if (!cancelled) setCapabilities(next);
      })
      .catch((error) => {
        if (!cancelled) setCapabilityError(error instanceof Error ? error.message : "Payment readiness is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const setStatus = (key: string, phase: PaymentPhase, message: string) => {
    setStatusByKey((current) => ({ ...current, [key]: { phase, message } }));
  };

  const copyAddress = async (key: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(""), 1200);
    } catch {
      setStatus(key, "error", "Clipboard access failed.");
    }
  };

  const verifyOnChainReference = async (key: string, credentials = pendingByKey[key]) => {
    const txId = (referenceByKey[key] ?? "").trim();
    if (!credentials) {
      setStatus(key, "error", "Start this payment again to create a fresh verification intent.");
      return;
    }
    if (!txId) {
      setStatus(key, "error", "Paste the transaction hash or signature from your wallet.");
      return;
    }
    setBusyKey(key);
    setStatus(key, "confirming", "Checking the network for confirmations. Keep this dialog open.");
    try {
      await verifyPaymentIntentWithPolling({
        credentials,
        proof: { txId },
        onPending: (message) => setStatus(key, "confirming", message)
      });
      setPendingByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setStatus(key, "verified", "Payment verified by dStream.");
    } catch (error) {
      setStatus(
        key,
        "reference",
        error instanceof Error ? error.message : "Verification did not complete. Retry without paying again."
      );
    } finally {
      setBusyKey("");
    }
  };

  const verifyLightningReceipt = async (key: string, pending: PendingLightningPayment) => {
    setBusyKey(key);
    setStatus(key, "confirming", "Waiting for the recipient's signed Lightning receipt.");
    try {
      const receipt = await waitForLightningZapReceipt({
        relays,
        providerPubkey: pending.providerPubkey,
        recipientPubkey: streamPubkey,
        invoice: pending.invoice,
        zapRequestJson: pending.zapRequestJson,
        createdAtSec: pending.createdAtSec
      });
      await verifyPaymentIntent({
        credentials: pending.credentials,
        proof: {
          zapReceipt: receipt,
          invoice: pending.invoice,
          preimage: pending.preimage,
          lightningAddress: pending.credentials.intent.address
        }
      });
      setPendingLightningByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setStatus(key, "verified", "Lightning payment verified by dStream.");
    } catch (error) {
      setStatus(
        key,
        "confirming",
        error instanceof Error ? `${error.message} Retry receipt verification without paying again.` : "Receipt verification is still pending."
      );
    } finally {
      setBusyKey("");
    }
  };

  const send = async (method: StreamPaymentMethod) => {
    const key = methodKey(method);
    const amount = (amountByKey[key] ?? method.amount ?? "").trim();
    setBusyKey(key);
    setStatus(key, "wallet", "Creating a payment intent.");
    try {
      if (!identity) throw new Error("Connect a Nostr identity before paying.");
      if (!amount) throw new Error("Enter an amount first.");
      const capability = capabilities ? capabilityForMethod(method, capabilities) : null;
      if (!capability?.configured) {
        throw new Error(capability?.reason || "This settlement rail is not ready on dStream.");
      }
      const buyerProofEvent = await buildPaymentIntentProof({
        signEvent: async (event) => signEvent(event as any),
        pubkey: identity.pubkey,
        streamPubkey,
        streamId
      });
      const credentials = await createTipPaymentIntent({
        buyerProofEvent,
        recipientPubkey: streamPubkey,
        streamId,
        method,
        amount
      });
      const canonicalMethod = paymentMethodFromIntent(credentials.intent);

      if (isLightningMethod(canonicalMethod)) {
        if (!/^\d+$/.test(credentials.intent.amount) || BigInt(credentials.intent.amount) <= 0n) {
          throw new Error("Lightning amount must be positive sats.");
        }
        setStatus(key, "wallet", "Requesting an intent-bound Lightning invoice.");
        const invoice = await requestLightningZapInvoice({
          destination: credentials.intent.address,
          amountSats: BigInt(credentials.intent.amount),
          senderPubkey: identity.pubkey,
          recipientPubkey: streamPubkey,
          relays,
          content: `dstream-intent:${credentials.intent.id}`,
          eventCoordinate: makeATag(streamPubkey, streamId),
          signEvent: async (event) => signEvent(event as any)
        });
        if (!invoice.metadata.nostrPubkey) throw new Error("Lightning provider did not advertise a receipt signing key.");
        setStatus(key, "wallet", "Approve the exact invoice in your Lightning wallet.");
        const paid = await payLightningInvoice(invoice.invoice);
        if (!paid.ok) throw new Error(paid.error || "Lightning payment failed.");
        const pending: PendingLightningPayment = {
          credentials,
          invoice: invoice.invoice,
          zapRequestJson: invoice.zapRequestJson,
          providerPubkey: invoice.metadata.nostrPubkey,
          createdAtSec: Number((invoice.zapRequest as any).created_at ?? credentials.intent.createdAtSec),
          preimage: paid.preimage
        };
        setPendingLightningByKey((current) => ({ ...current, [key]: pending }));
        setBusyKey("");
        await verifyLightningReceipt(key, pending);
        return;
      }

      setStatus(key, "wallet", "Approve the exact recipient and amount in your wallet.");
      const result = await sendNativeWalletPayment(canonicalMethod);
      if (!result.ok) throw new Error(result.error || "Wallet payment failed.");
      setPendingByKey((current) => ({ ...current, [key]: credentials }));
      if (!result.txId) {
        setStatus(key, "reference", "Wallet opened. After sending, paste its transaction hash or signature below.");
        return;
      }
      setReferenceByKey((current) => ({ ...current, [key]: result.txId! }));
      setStatus(key, "confirming", "Transaction submitted. Waiting for required confirmations.");
      await verifyPaymentIntentWithPolling({
        credentials,
        proof: { txId: result.txId },
        onPending: (message) => setStatus(key, "confirming", message)
      });
      setPendingByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setStatus(key, "verified", "Payment verified by dStream.");
    } catch (error) {
      const hasPending = !!pendingByKey[key] || !!pendingLightningByKey[key];
      setStatus(
        key,
        hasPending ? "reference" : "error",
        error instanceof Error ? error.message : "Payment failed."
      );
    } finally {
      setBusyKey("");
    }
  };

  if (showMonero) {
    return (
      <MoneroTipDialog
        open={open}
        streamPubkey={streamPubkey}
        streamId={streamId}
        broadcasterName={broadcasterName}
        onClose={() => {
          setShowMonero(false);
          onClose();
        }}
      />
    );
  }
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/80" onClick={onClose} aria-label="Close tip dialog" />
      <section className="relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-100">
              <Zap className="h-4 w-4 text-yellow-400" /> Support creator
            </h3>
            {broadcasterName ? <p className="mt-1 text-xs text-neutral-500">{broadcasterName}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-neutral-400 hover:bg-neutral-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto p-4">
          {capabilityError ? (
            <div className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">{capabilityError}</div>
          ) : null}
          {methods.length ? (
            methods.map((method) => {
              const key = methodKey(method);
              const isMonero = method.asset === "xmr";
              const capability = capabilities ? capabilityForMethod(method, capabilities) : null;
              const railReady = isMonero || capability?.configured === true;
              const nativeCapability = getNativeWalletCapability({ ...method, amount: amountByKey[key] ?? method.amount });
              const status = statusByKey[key];
              const pending = pendingByKey[key];
              const pendingLightning = pendingLightningByKey[key];
              const busy = busyKey === key;
              const lightning = isLightningMethod(method);
              const statusColor =
                status?.phase === "verified"
                  ? "text-emerald-300"
                  : status?.phase === "error"
                    ? "text-red-300"
                    : "text-amber-200";
              return (
                <article key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-neutral-100">
                        {PAYMENT_ASSET_META[method.asset].name}
                        {method.label ? <span className="font-normal text-neutral-500"> · {method.label}</span> : null}
                      </div>
                      <div className="text-[11px] text-neutral-500">{method.network || getPaymentRailForMethod(method).name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAddress(key, method.address)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:border-neutral-500"
                      title="Copy address"
                    >
                      {copiedKey === key ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 truncate font-mono text-xs text-neutral-400" title={method.address}>{method.address}</div>

                  {!isMonero ? (
                    <div className="mt-3 flex gap-2">
                      <input
                        value={amountByKey[key] ?? method.amount ?? ""}
                        onChange={(event) => setAmountByKey((current) => ({ ...current, [key]: event.target.value }))}
                        inputMode={lightning ? "numeric" : "decimal"}
                        placeholder={lightning ? "Sats" : PAYMENT_ASSET_META[method.asset].symbol}
                        disabled={!!method.amount || busy}
                        className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500 disabled:text-neutral-500"
                      />
                      <button
                        type="button"
                        onClick={() => void send(method)}
                        disabled={busy || !railReady}
                        className="inline-flex min-w-[6.5rem] items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                        title={!railReady ? capability?.reason || "Settlement verifier unavailable" : nativeCapability.reason}
                      >
                        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                        {busy ? "Checking" : pending || pendingLightning ? "Pay again" : "Pay"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowMonero(true)}
                      className="mt-3 inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500"
                    >
                      <Wallet className="h-4 w-4" /> Verified Monero tip
                    </button>
                  )}

                  {!isMonero && capabilities && !railReady ? (
                    <div className="mt-2 text-[11px] text-neutral-500">
                      {capability?.reason || "This settlement verifier is not configured on dStream."}
                    </div>
                  ) : null}

                  {pending ? (
                    <div className="mt-3 flex gap-2">
                      <input
                        value={referenceByKey[key] ?? ""}
                        onChange={(event) => setReferenceByKey((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder="Transaction hash or signature"
                        className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => void verifyOnChainReference(key)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-4 w-4" /> Verify
                      </button>
                    </div>
                  ) : null}

                  {pendingLightning && !busy ? (
                    <button
                      type="button"
                      onClick={() => void verifyLightningReceipt(key, pendingLightning)}
                      className="mt-3 inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800"
                    >
                      <RefreshCw className="h-4 w-4" /> Retry receipt verification
                    </button>
                  ) : null}

                  {status?.message ? <div className={`mt-2 text-xs ${statusColor}`}>{status.message}</div> : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
              This creator has not published a payment address yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
