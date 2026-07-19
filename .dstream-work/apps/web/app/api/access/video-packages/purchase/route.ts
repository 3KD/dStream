import { getVideoAccessPackageById, grantVideoPackagePurchaseAccess } from "@/lib/access/packages";
import { verifyAccessProof } from "@/lib/access/proof";
import { hasExternalPurchaseVerifier, verifyExternalPurchase } from "@/lib/access/purchaseVerifier";
import type { VideoCheckoutVerificationMode } from "@/lib/access/videoCheckout";
import { getVideoPurchasePolicyFromMetadata } from "@/lib/access/videoPackagePolicy";
import { verifyStakeSession } from "@/lib/monero/stakeSession";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import {
  NativePaymentVerificationError,
  verifyPayment
} from "@/lib/payments/server";
import { authorizePaymentIntent } from "@/lib/payments/server/intentStore";
import { recordNativePaymentSettlement } from "@/lib/payments/server/settlementStore";
import { asString, authorizeAccessAdmin, parseBoolean } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFirstTagValue(tags: unknown, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const rawTag of tags) {
    if (!Array.isArray(rawTag)) continue;
    if (rawTag[0] !== name) continue;
    if (typeof rawTag[1] !== "string") continue;
    const value = rawTag[1].trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function allowUnverifiedPurchases(): boolean {
  const raw = (process.env.DSTREAM_ACCESS_ALLOW_UNVERIFIED_PURCHASES ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

function purchasePolicyError(policy: "operator_or_verified" | "verified_only" | "unverified_ok"): string {
  if (policy === "verified_only") return "This package requires verified settlement.";
  if (policy === "unverified_ok") return "Unverified unlocks are disabled on this deployment.";
  return "This package requires verified settlement or host operator confirmation.";
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const packageId = asString(payload.packageId);
  if (!packageId) return Response.json({ ok: false, error: "packageId is required" }, { status: 400 });

  const buyerProof = verifyAccessProof(payload.buyerProofEvent, "access_purchase");
  if (!buyerProof.ok) return Response.json({ ok: false, error: buyerProof.error }, { status: buyerProof.status });

  const pkg = getVideoAccessPackageById(packageId);
  if (!pkg) return Response.json({ ok: false, error: "Video package not found." }, { status: 404 });
  if (pkg.status !== "active") {
    return Response.json({ ok: false, error: "Video package is disabled." }, { status: 403 });
  }
  const packagePurchasePolicy = getVideoPurchasePolicyFromMetadata(pkg.metadata);

  const buyerProofEvent = payload.buyerProofEvent as { tags?: string[][] } | undefined;
  const proofHostTag = getFirstTagValue(buyerProofEvent?.tags, "host");
  if (proofHostTag !== pkg.hostPubkey) {
    return Response.json({ ok: false, error: "Signed purchase proof host does not match package host." }, { status: 403 });
  }
  const proofPackageTag = getFirstTagValue(buyerProofEvent?.tags, "pkg");
  if (proofPackageTag !== pkg.id) {
    return Response.json({ ok: false, error: "Signed purchase proof package id does not match package." }, { status: 403 });
  }

  let source: "purchase_verified" | "purchase_unverified" = "purchase_unverified";
  let verificationMode: VideoCheckoutVerificationMode = "unverified_fallback";
  let sourceRef = asString(payload.sourceRef) || undefined;
  let settlementRef = asString(payload.settlementRef) || undefined;
  let actorPubkey: string | null = buyerProof.pubkey;
  const paymentProof = payload.paymentProof ?? payload.settlementProof ?? null;
  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? ({ ...payload.metadata } as Record<string, unknown>)
      : {};
  metadata.purchasePolicy = packagePurchasePolicy;
  metadata.purchasePolicyEnforcedAtSec = Math.floor(Date.now() / 1000);

  const stakeSessionToken = asString(payload.stakeSessionToken);
  const paymentIntentId = asString(payload.paymentIntentId);
  const paymentIntentSecret = asString(payload.paymentIntentSecret);
  if (paymentIntentId || paymentIntentSecret) {
    if (!paymentIntentId || !paymentIntentSecret) {
      return Response.json({ ok: false, error: "Both payment intent id and secret are required." }, { status: 400 });
    }
    try {
      const intent = authorizePaymentIntent(paymentIntentId, paymentIntentSecret).intent;
      if (intent.status !== "settled" || !intent.payment || !intent.settlementKey) {
        return Response.json({ ok: false, error: "Payment intent has not settled yet." }, { status: 402 });
      }
      if (intent.scope.type !== "video_package" || intent.scope.id !== pkg.id) {
        return Response.json({ ok: false, error: "Payment intent does not belong to this Video package." }, { status: 403 });
      }
      if (intent.scope.packageUpdatedAtSec !== pkg.updatedAtSec) {
        return Response.json({ ok: false, error: "Video package payment terms changed; create a new payment intent." }, { status: 409 });
      }
      if (intent.buyerPubkey !== buyerProof.pubkey) {
        return Response.json({ ok: false, error: "Payment intent belongs to another buyer." }, { status: 403 });
      }
      source = "purchase_verified";
      sourceRef = `payment_intent:${intent.id}`;
      settlementRef = intent.settlementKey;
      verificationMode = intent.railId === "xmr" ? "stake_verified" : "native_verified";
      Object.assign(metadata, {
        verificationMode,
        paymentIntentId: intent.id,
        railId: intent.railId,
        asset: intent.asset,
        network: intent.network,
        txId: intent.payment.txId,
        recipient: intent.payment.recipient,
        amountAtomic: intent.payment.amountAtomic,
        confirmations: intent.payment.confirmations,
        blockHeight: intent.payment.blockHeight,
        finality: intent.payment.finality
      });
    } catch (error) {
      const status = error instanceof NativePaymentVerificationError ? error.status : 502;
      const message = error instanceof Error ? error.message : "Payment intent validation failed.";
      return Response.json({ ok: false, error: message }, { status });
    }
  } else if (stakeSessionToken) {
    if (pkg.paymentAsset !== "xmr") {
      return Response.json({ ok: false, error: "A Monero stake session cannot settle this package asset." }, { status: 400 });
    }
    const session = verifyStakeSession(stakeSessionToken);
    if (!session) return Response.json({ ok: false, error: "Invalid stake session token." }, { status: 400 });
    if (session.viewerPubkey !== buyerProof.pubkey) {
      return Response.json({ ok: false, error: "Stake session does not belong to the purchasing viewer." }, { status: 403 });
    }
    if (session.streamPubkey !== pkg.hostPubkey || session.streamId !== pkg.streamId) {
      return Response.json({ ok: false, error: "Stake session scope does not match this Video package stream." }, { status: 403 });
    }

    const client = getXmrWalletRpcClient();
    if (!client) return Response.json({ ok: false, error: "xmr wallet rpc not configured" }, { status: 503 });

    try {
      const addresses = await client.getAddress({ accountIndex: session.accountIndex });
      const address = addresses.addresses.find((row) => row.addressIndex === session.addressIndex)?.address;
      if (!address) throw new Error("Monero payment subaddress is unavailable.");
      const payment = await verifyPayment({
        asset: "xmr",
        address,
        amount: pkg.paymentAmount,
        paymentRailId: "xmr",
        recipientPubkey: pkg.hostPubkey,
        proof: { xmrSessionToken: stakeSessionToken, xmrSessionKind: "stake" }
      });
      const settlement = recordNativePaymentSettlement({ payment, packageId: pkg.id, buyerPubkey: buyerProof.pubkey });
      source = "purchase_verified";
      sourceRef = sourceRef || `payment_settlement:${payment.settlementKey}`;
      settlementRef = settlementRef || payment.settlementKey;
      metadata.railId = "xmr";
      metadata.asset = "xmr";
      metadata.confirmedAtomic = payment.amountAtomic;
      metadata.lastTxid = payment.txId;
      metadata.accountIndex = session.accountIndex;
      metadata.addressIndex = session.addressIndex;
      metadata.settlementRecordId = settlement.record.id;
      metadata.settlementRecordExisting = settlement.existing;
      verificationMode = "stake_verified";
      metadata.verificationMode = verificationMode;
    } catch (error) {
      const status = error instanceof NativePaymentVerificationError ? error.status : 502;
      const detail = error instanceof Error ? error.message : "unknown";
      return Response.json(
        { ok: false, error: `xmr stake verification error (${detail})` },
        { status }
      );
    }
  } else {
    if (paymentProof && pkg.paymentAsset !== "xmr") {
      return Response.json(
        { ok: false, error: "Create and settle a one-time payment intent before granting package access." },
        { status: 400 }
      );
    } else {
      const verifiedByOperator = parseBoolean(payload.verifiedByOperator);
      const externalVerifierConfigured = hasExternalPurchaseVerifier();
      const canUseOperatorOverride = packagePurchasePolicy === "operator_or_verified";
      const canUseUnverifiedFallback = packagePurchasePolicy === "unverified_ok" && allowUnverifiedPurchases();

      if (externalVerifierConfigured) {
        const verification = await verifyExternalPurchase({
          package: pkg,
          buyerPubkey: buyerProof.pubkey,
          buyerProofEvent: payload.buyerProofEvent,
          sourceRef,
          settlementRef,
          paymentProof,
          metadata
        });
        if (verification.verified) {
          source = "purchase_verified";
          sourceRef = verification.sourceRef || sourceRef;
          settlementRef = verification.settlementRef || settlementRef;
          Object.assign(metadata, verification.metadata ?? {});
          verificationMode = "external_verified";
          metadata.verificationMode = verificationMode;
        } else if (verifiedByOperator && canUseOperatorOverride) {
          const auth = authorizeAccessAdmin(payload.operatorProofEvent, pkg.hostPubkey);
          if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
          source = "purchase_verified";
          actorPubkey = auth.actorPubkey;
          metadata.operatorOverride = true;
          metadata.externalVerifierError = verification.error ?? "verification failed";
          verificationMode = "operator_override";
          metadata.verificationMode = verificationMode;
        } else if (canUseUnverifiedFallback) {
          source = "purchase_unverified";
          metadata.externalVerifierError = verification.error ?? "verification failed";
          metadata.unverifiedFallback = true;
          verificationMode = "unverified_fallback";
          metadata.verificationMode = verificationMode;
        } else {
          return Response.json(
            {
              ok: false,
              error: verification.error ?? purchasePolicyError(packagePurchasePolicy)
            },
            { status: verification.status >= 400 && verification.status < 600 ? verification.status : 402 }
          );
        }
      } else if (verifiedByOperator && canUseOperatorOverride) {
        const auth = authorizeAccessAdmin(payload.operatorProofEvent, pkg.hostPubkey);
        if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        source = "purchase_verified";
        actorPubkey = auth.actorPubkey;
        metadata.operatorOverride = true;
        verificationMode = "operator_override";
        metadata.verificationMode = verificationMode;
      } else if (canUseUnverifiedFallback) {
        source = "purchase_unverified";
        metadata.unverifiedFallback = true;
        verificationMode = "unverified_fallback";
        metadata.verificationMode = verificationMode;
      } else {
        return Response.json({ ok: false, error: purchasePolicyError(packagePurchasePolicy) }, { status: 402 });
      }
    }
  }

  try {
    const result = grantVideoPackagePurchaseAccess({
      packageId: pkg.id,
      viewerPubkey: buyerProof.pubkey,
      source,
      sourceRef,
      settlementRef,
      metadata
    });
    return Response.json({
      ok: true,
      package: result.package,
      entitlement: result.entitlement,
      purchase: {
        id: result.purchase.id,
        source: result.purchase.source,
        sourceRef: result.purchase.sourceRef,
        status: result.purchase.status,
        expiresAtSec: result.purchase.expiresAtSec
      },
      checkout: {
        purchasePolicy: packagePurchasePolicy,
        verificationMode
      },
      granted: result.granted,
      actorPubkey
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "failed to apply Video package purchase" }, { status: 400 });
  }
}
