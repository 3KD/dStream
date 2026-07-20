import { assertStreamIdentity, type StreamPaymentMethod } from "@dstream/protocol";
import { getVideoAccessPackageById } from "@/lib/access/packages";
import { verifyAccessProof } from "@/lib/access/proof";
import { getXmrWalletRpcClient } from "@/lib/monero/server";
import { verifyStakeSession } from "@/lib/monero/stakeSession";
import { verifyTipSession } from "@/lib/monero/tipSession";
import { getPaymentRailById, getPaymentRailForMethod, type PaymentRailId } from "@/lib/payments/rails";
import { normalizePaymentAddress, normalizePaymentAsset, validatePaymentAddress, validatePaymentAmount } from "@/lib/payments/methods";
import { createPaymentIntent, type PaymentIntentScope } from "@/lib/payments/server/intentStore";
import { getPaymentRailCapabilities, PaymentVerificationError } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function tagValue(event: unknown, name: string): string {
  const tags = (event as { tags?: unknown })?.tags;
  if (!Array.isArray(tags)) return "";
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") return tag[1].trim();
  }
  return "";
}

function railForMethod(method: StreamPaymentMethod, requestedRail?: string): PaymentRailId {
  const normalized = asString(requestedRail).toLowerCase() as PaymentRailId;
  if (!normalized) return getPaymentRailForMethod(method).id;
  const rail = getPaymentRailById(normalized);
  if (rail.id !== normalized || !rail.assets.includes(method.asset)) {
    throw new PaymentVerificationError(`${method.asset.toUpperCase()} is not supported on the requested payment rail.`, 400);
  }
  return rail.id;
}

async function resolveMoneroSession(input: {
  token: string;
  kind: "stake" | "tip";
  buyerPubkey: string;
  streamPubkey: string;
  streamId: string;
}): Promise<{ address: string; context: Record<string, unknown> }> {
  const client = getXmrWalletRpcClient();
  if (!client) throw new PaymentVerificationError("Monero wallet RPC is not configured.", 503);
  const session = input.kind === "stake" ? verifyStakeSession(input.token) : verifyTipSession(input.token);
  if (!session) throw new PaymentVerificationError(`Monero ${input.kind} session is invalid.`, 400);
  if (session.streamPubkey !== input.streamPubkey || session.streamId !== input.streamId) {
    throw new PaymentVerificationError("Monero payment session scope does not match this intent.", 403);
  }
  if (input.kind === "stake" && "viewerPubkey" in session && session.viewerPubkey !== input.buyerPubkey) {
    throw new PaymentVerificationError("Monero payment session belongs to another buyer.", 403);
  }
  const addresses = await client.getAddress({ accountIndex: session.accountIndex });
  const address = addresses.addresses.find((row) => row.addressIndex === session.addressIndex)?.address;
  if (!address) throw new PaymentVerificationError("Monero wallet RPC could not resolve the payment subaddress.", 502);
  return {
    address,
    context: { xmrSessionToken: input.token, xmrSessionKind: input.kind }
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const scopeType = asString(payload.scopeType);
    const proofScope = scopeType === "video_package" ? "access_purchase" : "payment_intent";
    const proof = verifyAccessProof(payload.buyerProofEvent, proofScope);
    if (!proof.ok) return Response.json({ ok: false, error: proof.error }, { status: proof.status });

    let scope: PaymentIntentScope;
    let recipientPubkey: string;
    let method: StreamPaymentMethod;
    let requestedRail = asString(payload.paymentRailId);
    let verificationContext: Record<string, unknown> = {};

    if (scopeType === "video_package") {
      const packageId = asString(payload.packageId);
      const pkg = getVideoAccessPackageById(packageId);
      if (!pkg) throw new PaymentVerificationError("Video package not found.", 404);
      if (pkg.status !== "active") throw new PaymentVerificationError("Video package is disabled.", 403);
      if (tagValue(payload.buyerProofEvent, "host") !== pkg.hostPubkey || tagValue(payload.buyerProofEvent, "pkg") !== pkg.id) {
        throw new PaymentVerificationError("Signed purchase proof does not match the Video package.", 403);
      }
      recipientPubkey = pkg.hostPubkey;
      requestedRail = pkg.paymentRailId ?? requestedRail;
      const network = asString((pkg.metadata as Record<string, unknown>).paymentNetwork) || requestedRail;
      let address = pkg.paymentAddress ?? "";
      if (pkg.paymentAsset === "xmr") {
        const session = await resolveMoneroSession({
          token: asString(payload.xmrSessionToken),
          kind: "stake",
          buyerPubkey: proof.pubkey,
          streamPubkey: pkg.hostPubkey,
          streamId: pkg.streamId
        });
        address = session.address;
        verificationContext = session.context;
      }
      method = { asset: pkg.paymentAsset, address, amount: pkg.paymentAmount, network };
      scope = {
        type: "video_package",
        id: pkg.id,
        hostPubkey: pkg.hostPubkey,
        streamId: pkg.streamId,
        resourceId: pkg.resourceId,
        packageUpdatedAtSec: pkg.updatedAtSec
      };
    } else if (scopeType === "tip") {
      recipientPubkey = asString(payload.recipientPubkey).toLowerCase();
      const streamId = asString(payload.streamId);
      assertStreamIdentity(recipientPubkey, streamId);
      const asset = normalizePaymentAsset(payload.asset);
      if (!asset) throw new PaymentVerificationError("Payment asset is unsupported.", 400);
      const network = asString(payload.network);
      let address = normalizePaymentAddress(asset, asString(payload.address), network);
      if (asset === "xmr") {
        const session = await resolveMoneroSession({
          token: asString(payload.xmrSessionToken),
          kind: "tip",
          buyerPubkey: proof.pubkey,
          streamPubkey: recipientPubkey,
          streamId
        });
        address = session.address;
        verificationContext = session.context;
      }
      method = { asset, address, amount: asString(payload.amount), network };
      scope = { type: "tip", id: `${recipientPubkey}:${streamId}`, streamPubkey: recipientPubkey, streamId };
    } else {
      throw new PaymentVerificationError("scopeType must be video_package or tip.", 400);
    }

    if (!method.address) throw new PaymentVerificationError("Payment recipient address is not configured.", 400);
    const addressError = validatePaymentAddress(method.asset, method.address, method.network);
    if (addressError) throw new PaymentVerificationError(addressError, 400);
    const amountError = validatePaymentAmount(method.asset, method.amount ?? "", method.network ?? "", method.address);
    if (amountError || !method.amount) throw new PaymentVerificationError(amountError || "Payment amount is required.", 400);
    const railId = railForMethod(method, requestedRail);
    const capability = getPaymentRailCapabilities().find((row) => row.railId === railId && row.asset === method.asset);
    if (!capability?.configured) {
      throw new PaymentVerificationError(
        capability?.reason || `${method.asset.toUpperCase()} settlement is not configured on the ${railId} rail.`,
        503
      );
    }
    const created = createPaymentIntent({
      scope,
      buyerPubkey: proof.pubkey,
      recipientPubkey,
      asset: method.asset,
      railId,
      network: method.network ?? railId,
      address: method.address,
      amount: method.amount,
      verificationContext
    });
    return Response.json({ ok: true, ...created }, { status: 201 });
  } catch (error) {
    const status = error instanceof PaymentVerificationError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Failed to create payment intent.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
