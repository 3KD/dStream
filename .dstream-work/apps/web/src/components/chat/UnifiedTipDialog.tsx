"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Wallet, X, Zap } from "lucide-react";
import type { StreamPaymentMethod } from "@dstream/protocol";
import { makeATag } from "@dstream/protocol";
import { TipDialog as MoneroTipDialog } from "@/components/monero/TipDialog";
import { useIdentity } from "@/context/IdentityContext";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { getNostrRelays } from "@/lib/config";
import { PAYMENT_ASSET_META, buildPaymentUri } from "@/lib/payments/catalog";
import { requestLightningZapInvoice } from "@/lib/payments/lightning";
import { payLightningInvoice } from "@/lib/payments/lightningWallet";
import { getNativeWalletCapability, sendNativeWalletPayment } from "@/lib/payments/nativeWallet";

interface UnifiedTipDialogProps {
  open: boolean;
  streamPubkey: string;
  streamId: string;
  broadcasterName?: string;
  onClose: () => void;
}

function methodKey(method: StreamPaymentMethod): string {
  return `${method.asset}:${method.network ?? ""}:${method.address}`;
}

export function UnifiedTipDialog({ open, streamPubkey, streamId, broadcasterName, onClose }: UnifiedTipDialogProps) {
  const profile = useNostrProfile(streamPubkey)?.profile;
  const { identity, signEvent } = useIdentity();
  const relays = useMemo(() => getNostrRelays(), []);
  const [showMonero, setShowMonero] = useState(false);
  const [amountByKey, setAmountByKey] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [statusByKey, setStatusByKey] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [copiedKey, setCopiedKey] = useState("");

  const methods = useMemo(() => {
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
  }, [profile]);

  const copyAddress = async (key: string, address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1200);
  };

  const send = async (method: StreamPaymentMethod) => {
    const key = methodKey(method);
    const amount = (amountByKey[key] ?? "").trim();
    setBusyKey(key);
    setStatusByKey((current) => ({ ...current, [key]: { ok: false, message: "" } }));
    try {
      if (!amount) throw new Error("Enter an amount first.");
      if (method.asset === "btc" && method.network === "lightning") {
        if (!identity) throw new Error("Connect a Nostr identity to sign the zap request.");
        if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error("Lightning amount must be positive sats.");
        const invoice = await requestLightningZapInvoice({
          destination: method.address,
          amountSats: BigInt(amount),
          senderPubkey: identity.pubkey,
          recipientPubkey: streamPubkey,
          relays,
          eventCoordinate: makeATag(streamPubkey, streamId),
          signEvent: async (event) => signEvent(event as any)
        });
        const paid = await payLightningInvoice(invoice.invoice);
        if (!paid.ok) throw new Error(paid.error || "Lightning payment failed.");
        setStatusByKey((current) => ({
          ...current,
          [key]: {
            ok: true,
            message: paid.pendingExternal ? "Invoice opened in your wallet." : "Zap paid; receipt pending."
          }
        }));
        return;
      }
      const result = await sendNativeWalletPayment({ ...method, amount });
      if (!result.ok) throw new Error(result.error || "Wallet payment failed.");
      setStatusByKey((current) => ({
        ...current,
        [key]: { ok: true, message: result.provider === "wallet_uri" ? "Opened wallet app." : "Payment submitted." }
      }));
    } catch (error) {
      setStatusByKey((current) => ({
        ...current,
        [key]: { ok: false, message: error instanceof Error ? error.message : "Payment failed." }
      }));
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
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/80" onClick={onClose} aria-label="Close tip dialog" />
      <section className="relative z-10 flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
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
          {methods.length ? (
            methods.map((method) => {
              const key = methodKey(method);
              const capability = getNativeWalletCapability(method);
              const walletUri = buildPaymentUri(method);
              const status = statusByKey[key];
              const isLightning = method.asset === "btc" && method.network === "lightning";
              return (
                <article key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-neutral-100">{PAYMENT_ASSET_META[method.asset].name}</div>
                      <div className="text-[11px] text-neutral-500">{method.network}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAddress(key, method.address)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:border-neutral-500"
                      title="Copy address"
                    >
                      {copiedKey === key ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 truncate font-mono text-xs text-neutral-400" title={method.address}>{method.address}</div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={amountByKey[key] ?? ""}
                      onChange={(event) => setAmountByKey((current) => ({ ...current, [key]: event.target.value }))}
                      inputMode="decimal"
                      placeholder={isLightning ? "Sats" : PAYMENT_ASSET_META[method.asset].symbol}
                      className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => void send(method)}
                      disabled={busyKey === key || (!isLightning && !capability.supported)}
                      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      <Wallet className="h-4 w-4" />
                      {busyKey === key ? "Sending" : "Pay"}
                    </button>
                    {walletUri ? (
                      <a href={walletUri} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:border-neutral-500" title="Open wallet">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                  {status?.message ? <p className={`mt-2 text-xs ${status.ok ? "text-emerald-300" : "text-red-300"}`}>{status.message}</p> : null}
                </article>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-neutral-500">This creator has no supported payment address.</p>
          )}

          <button
            type="button"
            onClick={() => setShowMonero(true)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
          >
            Create private Monero payment
          </button>
        </div>
      </section>
    </div>
  );
}
