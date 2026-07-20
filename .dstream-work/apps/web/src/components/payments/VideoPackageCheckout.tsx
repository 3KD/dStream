"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { makeATag, type NostrEvent, type StreamPaymentMethod } from "@dstream/protocol";
import { useIdentity } from "@/context/IdentityContext";
import {
  buildAccessPurchaseProof,
  buildAccessViewerProof,
  buildPlaybackAccessProof,
  issuePlaybackAccessTokenClient,
  listVideoPackageViewerStatusClient,
  purchaseVideoAccessPackageClient,
  type VideoAccessPackage
} from "@/lib/access/client";
import { getNostrRelays } from "@/lib/config";
import { PAYMENT_ASSET_META } from "@/lib/payments/catalog";
import { requestLightningZapInvoice } from "@/lib/payments/lightning";
import { payLightningInvoice } from "@/lib/payments/lightningWallet";
import { sendNativeWalletPayment } from "@/lib/payments/nativeWallet";
import {
  capabilityForMethod,
  createVideoPackagePaymentIntent,
  loadPaymentRailCapabilities,
  paymentMethodFromIntent,
  verifyPaymentIntent,
  verifyPaymentIntentWithPolling,
  waitForLightningZapReceipt,
  type ClientPaymentRailCapability,
  type PaymentIntentCredentials
} from "@/lib/payments/paymentIntents";
import { getPaymentRailForMethod } from "@/lib/payments/rails";

interface VideoPackageCheckoutProps {
  packages: VideoAccessPackage[];
  announceEvent: NostrEvent | null;
  streamPubkey: string;
  streamId: string;
  originStreamId: string;
  onUnlocked: (input: { token: string; expiresAtMs: number; package: VideoAccessPackage }) => void;
}

interface PendingLightningPayment {
  credentials: PaymentIntentCredentials;
  buyerProofEvent: NostrEvent;
  invoice: string;
  zapRequestJson: string;
  providerPubkey: string;
  createdAtSec: number;
  preimage?: string;
}

function packageMethod(pkg: VideoAccessPackage): StreamPaymentMethod {
  const metadataNetwork = typeof pkg.metadata?.paymentNetwork === "string" ? pkg.metadata.paymentNetwork.trim() : "";
  return {
    asset: pkg.paymentAsset,
    address: pkg.paymentAddress ?? "",
    amount: pkg.paymentAmount,
    network: metadataNetwork || pkg.paymentRailId
  };
}

function base64EncodeUtf8(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

export function VideoPackageCheckout({
  packages,
  announceEvent,
  streamPubkey,
  streamId,
  originStreamId,
  onUnlocked
}: VideoPackageCheckoutProps) {
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const [selectedId, setSelectedId] = useState(packages[0]?.id ?? "");
  const [capabilities, setCapabilities] = useState<ClientPaymentRailCapability[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading payment readiness...");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState<{ credentials: PaymentIntentCredentials; buyerProofEvent: NostrEvent } | null>(null);
  const [pendingLightning, setPendingLightning] = useState<PendingLightningPayment | null>(null);

  useEffect(() => {
    if (!packages.some((pkg) => pkg.id === selectedId)) setSelectedId(packages[0]?.id ?? "");
  }, [packages, selectedId]);

  useEffect(() => {
    let cancelled = false;
    void loadPaymentRailCapabilities()
      .then((rows) => {
        if (cancelled) return;
        setCapabilities(rows);
        setStatus("");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Payment readiness is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPackage = packages.find((pkg) => pkg.id === selectedId) ?? packages[0] ?? null;
  const selectedMethod = selectedPackage ? packageMethod(selectedPackage) : null;
  const selectedCapability = selectedMethod && capabilities ? capabilityForMethod(selectedMethod, capabilities) : null;
  const railReady = selectedCapability?.configured === true;

  const issueAccess = async (pkg: VideoAccessPackage, entitlementExpiresAtSec?: number) => {
    if (!identity || !announceEvent) throw new Error("Signed stream details are unavailable. Reload the page and retry.");
    const viewerProofEvent = await buildPlaybackAccessProof(
      async (event) => signEvent(event as any),
      identity.pubkey,
      originStreamId
    );
    if (!viewerProofEvent) throw new Error("Failed to sign playback access proof.");
    const issued = await issuePlaybackAccessTokenClient({
      announceEvent,
      viewerProofEvent,
      streamPubkey,
      streamId,
      originStreamId
    });
    const expiresAtSec = entitlementExpiresAtSec
      ? Math.min(entitlementExpiresAtSec, issued.expiresAtSec)
      : issued.expiresAtSec;
    onUnlocked({ token: issued.token, expiresAtMs: expiresAtSec * 1000, package: pkg });
  };

  const finishPurchase = async (
    pkg: VideoAccessPackage,
    credentials: PaymentIntentCredentials,
    buyerProofEvent: NostrEvent
  ) => {
    setStatus("Payment verified. Granting playback access...");
    const purchase = await purchaseVideoAccessPackageClient({
      packageId: pkg.id,
      buyerProofEvent,
      paymentIntentId: credentials.intent.id,
      paymentIntentSecret: credentials.secret,
      metadata: { origin: "watch_checkout" }
    });
    await issueAccess(pkg, purchase.purchase.expiresAtSec);
    setPending(null);
    setPendingLightning(null);
    setReference("");
    setStatus("Payment verified. Playback is unlocked.");
  };

  const createXmrStakeSession = async (): Promise<string> => {
    if (!identity) throw new Error("Connect a Nostr identity before paying.");
    const url = `${window.location.origin}/api/xmr/stake/session`;
    const authEvent = await signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["u", url],
        ["method", "POST"]
      ],
      pubkey: identity.pubkey
    } as any);
    const response = await fetch("/api/xmr/stake/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Nostr ${base64EncodeUtf8(JSON.stringify(authEvent))}`
      },
      body: JSON.stringify({ streamPubkey, streamId }),
      cache: "no-store"
    });
    const body = (await response.json().catch(() => null)) as { session?: unknown; error?: unknown } | null;
    if (!response.ok || typeof body?.session !== "string") {
      throw new Error(
        typeof body?.error === "string" && body.error.trim()
          ? body.error
          : `Failed to create Monero payment session (${response.status}).`
      );
    }
    return body.session;
  };

  const verifyLightningReceipt = async (pkg: VideoAccessPackage, payment: PendingLightningPayment) => {
    setBusy(true);
    setStatus("Waiting for the recipient's signed Lightning receipt...");
    try {
      const receipt = await waitForLightningZapReceipt({
        relays,
        providerPubkey: payment.providerPubkey,
        recipientPubkey: streamPubkey,
        invoice: payment.invoice,
        zapRequestJson: payment.zapRequestJson,
        createdAtSec: payment.createdAtSec
      });
      await verifyPaymentIntent({
        credentials: payment.credentials,
        proof: {
          zapReceipt: receipt,
          invoice: payment.invoice,
          preimage: payment.preimage,
          lightningAddress: payment.credentials.intent.address
        }
      });
      await finishPurchase(pkg, payment.credentials, payment.buyerProofEvent);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `${error.message} Retry receipt verification without paying again.`
          : "Lightning receipt verification is still pending."
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyReference = async () => {
    if (!selectedPackage || !pending) return;
    const txId = reference.trim();
    if (!txId) {
      setStatus("Paste the transaction hash or signature from your wallet.");
      return;
    }
    setBusy(true);
    setStatus("Checking required network confirmations...");
    try {
      await verifyPaymentIntentWithPolling({
        credentials: pending.credentials,
        proof: { txId },
        onPending: setStatus
      });
      await finishPurchase(selectedPackage, pending.credentials, pending.buyerProofEvent);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Verification did not complete. Retry without paying again.");
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!selectedPackage || !selectedMethod) return;
    setBusy(true);
    setPending(null);
    setPendingLightning(null);
    setReference("");
    try {
      if (!identity) throw new Error("Connect a Nostr identity before purchasing access.");
      if (!selectedCapability?.configured) {
        throw new Error(selectedCapability?.reason || "This settlement rail is not ready on dStream.");
      }
      setStatus("Signing purchase terms...");
      const buyerProofEvent = await buildAccessPurchaseProof(
        async (event) => signEvent(event as any),
        identity.pubkey,
        { hostPubkey: selectedPackage.hostPubkey, packageId: selectedPackage.id }
      );
      if (!buyerProofEvent) throw new Error("Failed to sign the package purchase proof.");
      const xmrSessionToken = selectedPackage.paymentAsset === "xmr" ? await createXmrStakeSession() : undefined;
      const credentials = await createVideoPackagePaymentIntent({
        packageId: selectedPackage.id,
        buyerProofEvent,
        xmrSessionToken
      });
      const method = paymentMethodFromIntent(credentials.intent);

      if (getPaymentRailForMethod(method).id === "lightning") {
        if (!/^\d+$/.test(credentials.intent.amount) || BigInt(credentials.intent.amount) <= 0n) {
          throw new Error("Lightning package price must be positive sats.");
        }
        setStatus("Requesting an intent-bound Lightning invoice...");
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
        setStatus("Approve the exact invoice in your Lightning wallet.");
        const paid = await payLightningInvoice(invoice.invoice);
        if (!paid.ok) throw new Error(paid.error || "Lightning payment failed.");
        const nextPending: PendingLightningPayment = {
          credentials,
          buyerProofEvent,
          invoice: invoice.invoice,
          zapRequestJson: invoice.zapRequestJson,
          providerPubkey: invoice.metadata.nostrPubkey,
          createdAtSec: Number((invoice.zapRequest as any).created_at ?? credentials.intent.createdAtSec),
          preimage: paid.preimage
        };
        setPendingLightning(nextPending);
        setBusy(false);
        await verifyLightningReceipt(selectedPackage, nextPending);
        return;
      }

      setStatus("Approve the exact recipient and amount in your wallet.");
      const sent = await sendNativeWalletPayment(method);
      if (!sent.ok) throw new Error(sent.error || "Wallet payment failed.");
      setPending({ credentials, buyerProofEvent });

      if (method.asset === "xmr") {
        setStatus("Wallet opened. Waiting for the Monero payment and required confirmations...");
        await verifyPaymentIntentWithPolling({
          credentials,
          proof: {},
          onPending: setStatus
        });
        await finishPurchase(selectedPackage, credentials, buyerProofEvent);
        return;
      }

      if (!sent.txId) {
        setStatus("Wallet opened. After sending, paste its transaction hash or signature below.");
        return;
      }
      setReference(sent.txId);
      setStatus("Transaction submitted. Waiting for required confirmations...");
      await verifyPaymentIntentWithPolling({
        credentials,
        proof: { txId: sent.txId },
        onPending: setStatus
      });
      await finishPurchase(selectedPackage, credentials, buyerProofEvent);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Package payment failed.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selectedPackage || !identity) {
      setStatus("Connect the identity that purchased this package.");
      return;
    }
    setBusy(true);
    setStatus("Checking this identity's active access...");
    try {
      const viewerProofEvent = await buildAccessViewerProof(
        async (event) => signEvent(event as any),
        identity.pubkey,
        streamPubkey
      );
      if (!viewerProofEvent) throw new Error("Failed to sign the access lookup proof.");
      const result = await listVideoPackageViewerStatusClient({
        hostPubkey: streamPubkey,
        streamId,
        viewerProofEvent,
        status: "active"
      });
      const unlock = result.byPackageId[selectedPackage.id];
      if (!unlock) throw new Error("This identity does not have an active unlock for the selected package.");
      await issueAccess(selectedPackage, unlock.expiresAtSec);
      setStatus("Active access restored.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore package access.");
    } finally {
      setBusy(false);
    }
  };

  if (!selectedPackage || !selectedMethod) return null;
  const assetMeta = PAYMENT_ASSET_META[selectedPackage.paymentAsset];

  return (
    <section className="space-y-4 rounded-lg border border-amber-700/50 bg-amber-950/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-neutral-100">Unlock private video</div>
          <div className="mt-1 text-xs text-neutral-500">Verified payment grants {selectedPackage.durationHours} hours of access.</div>
        </div>
        <div className="font-mono text-sm text-amber-300">
          {selectedPackage.paymentAmount} {assetMeta.symbol}
        </div>
      </div>

      {packages.length > 1 ? (
        <select
          value={selectedPackage.id}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setPending(null);
            setPendingLightning(null);
            setReference("");
            setStatus("");
          }}
          disabled={busy}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
        >
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.id}>
              {pkg.title} - {pkg.paymentAmount} {PAYMENT_ASSET_META[pkg.paymentAsset].symbol}
            </option>
          ))}
        </select>
      ) : (
        <div className="text-sm text-neutral-300">{selectedPackage.title}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void pay()}
          disabled={busy || !railReady}
          title={!railReady ? selectedCapability?.reason || "Settlement verifier unavailable" : undefined}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {busy ? "Checking" : "Pay and unlock"}
        </button>
        <button
          type="button"
          onClick={() => void restore()}
          disabled={busy || !identity}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" /> Restore access
        </button>
      </div>

      {pending && selectedPackage.paymentAsset !== "xmr" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Transaction hash or signature"
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200"
          />
          <button
            type="button"
            onClick={() => void verifyReference()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" /> Verify
          </button>
        </div>
      ) : null}

      {pendingLightning && !busy ? (
        <button
          type="button"
          onClick={() => void verifyLightningReceipt(selectedPackage, pendingLightning)}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800"
        >
          <RefreshCw className="h-4 w-4" /> Retry Lightning receipt
        </button>
      ) : null}

      {status ? (
        <div className={`flex items-start gap-2 text-xs ${status.includes("unlocked") || status.includes("restored") ? "text-emerald-300" : "text-neutral-400"}`}>
          {status.includes("unlocked") || status.includes("restored") ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}
          <span>{status}</span>
        </div>
      ) : null}
    </section>
  );
}
