import { createHash } from "node:crypto";
import { getXmrConfirmationsRequired, getXmrWalletRpcClient } from "../../monero/server";
import { verifyStakeSession } from "../../monero/stakeSession";
import { getStakeTotals } from "../../monero/stakeVerify";
import { verifyTipSession } from "../../monero/tipSession";
import { findLatestIncomingTip } from "../../monero/tipVerify";
import { decimalToAtomic } from "./amount";
import type { PaymentRailCapability, PaymentVerificationInput, VerifiedPayment } from "./types";
import { PaymentVerificationError } from "./types";

function sessionFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getMoneroCapabilities(): PaymentRailCapability[] {
  const configured = !!getXmrWalletRpcClient();
  return [
    {
      asset: "xmr",
      railId: "xmr",
      network: "mainnet",
      configured,
      confirmationsRequired: getXmrConfirmationsRequired(),
      verifier: "wallet_rpc",
      ...(!configured ? { reason: "Monero wallet RPC is not configured." } : {})
    }
  ];
}

export async function verifyMoneroPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
  if (input.asset !== "xmr") throw new PaymentVerificationError("Monero verifier requires the XMR asset.", 400);
  const client = getXmrWalletRpcClient();
  if (!client) throw new PaymentVerificationError("Monero wallet RPC is not configured.", 503);
  const token = typeof input.proof?.xmrSessionToken === "string" ? input.proof.xmrSessionToken.trim() : "";
  const sessionKind = input.proof?.xmrSessionKind;
  if (!token || (sessionKind !== "stake" && sessionKind !== "tip")) {
    throw new PaymentVerificationError("Monero verification requires a dStream wallet-RPC payment session.", 400);
  }
  const expectedAtomic = decimalToAtomic(input.amount, 12);
  const confirmationsRequired = getXmrConfirmationsRequired();

  if (sessionKind === "stake") {
    const session = verifyStakeSession(token);
    if (!session) throw new PaymentVerificationError("Monero stake session is invalid.", 400);
    if (input.recipientPubkey && session.streamPubkey.toLowerCase() !== input.recipientPubkey.toLowerCase()) {
      throw new PaymentVerificationError("Monero stake session recipient does not match the payment intent.", 403);
    }
    const totals = await getStakeTotals({
      client,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      confirmationsRequired
    });
    const confirmedAtomic = BigInt(totals.confirmedAtomic);
    if (confirmedAtomic < expectedAtomic) {
      throw new PaymentVerificationError(
        `Monero payment is below the required amount (${confirmedAtomic}/${expectedAtomic} atomic units).`,
        402
      );
    }
    const txId = totals.lastTxid?.trim().toLowerCase() || sessionFingerprint(token);
    return {
      asset: "xmr",
      railId: "xmr",
      network: "mainnet",
      txId,
      settlementKey: `xmr:mainnet:stake:${sessionFingerprint(token)}`,
      recipient: input.address.trim(),
      amountAtomic: confirmedAtomic.toString(),
      confirmations: confirmationsRequired,
      blockHeight: 0,
      finality: "confirmed",
      payer: session.viewerPubkey,
      metadata: {
        sessionKind,
        streamPubkey: session.streamPubkey,
        streamId: session.streamId,
        accountIndex: session.accountIndex,
        addressIndex: session.addressIndex,
        transferCount: totals.transferCount,
        lastObservedAtMs: totals.lastObservedAtMs
      }
    };
  }

  const session = verifyTipSession(token);
  if (!session) throw new PaymentVerificationError("Monero tip session is invalid.", 400);
  if (input.recipientPubkey && session.streamPubkey.toLowerCase() !== input.recipientPubkey.toLowerCase()) {
    throw new PaymentVerificationError("Monero tip session recipient does not match the payment intent.", 403);
  }
  const match = await findLatestIncomingTip({
    client,
    accountIndex: session.accountIndex,
    addressIndex: session.addressIndex,
    confirmationsRequired
  });
  if (!match?.confirmed || BigInt(match.amountAtomic) < expectedAtomic) {
    throw new PaymentVerificationError("No sufficiently confirmed Monero payment was found for this session.", 402);
  }
  const txId = match.txid?.trim().toLowerCase() || sessionFingerprint(token);
  return {
    asset: "xmr",
    railId: "xmr",
    network: "mainnet",
    txId,
    settlementKey: `xmr:mainnet:tip:${sessionFingerprint(token)}:${txId}`,
    recipient: input.address.trim(),
    amountAtomic: match.amountAtomic,
    confirmations: match.confirmations ?? confirmationsRequired,
    blockHeight: 0,
    finality: "confirmed",
    metadata: {
      sessionKind,
      streamPubkey: session.streamPubkey,
      streamId: session.streamId,
      accountIndex: session.accountIndex,
      addressIndex: session.addressIndex,
      observedAtMs: match.observedAtMs
    }
  };
}
