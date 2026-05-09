"use client";

import { useCallback, useMemo, useState } from "react";
import { TipDialog as MoneroTipDialog } from "@/components/monero/TipDialog";
import { useNostrProfile } from "@/hooks/useNostrProfiles";
import { PAYMENT_ASSET_META, buildPaymentUri } from "@/lib/payments/catalog";
import { paymentMethodsFromProfile } from "@/lib/payments/profileMethods";
import { groupPaymentMethodsByRail } from "@/lib/payments/rails";
import type { StreamPaymentMethod } from "@dstream/protocol";

interface UnifiedTipDialogProps {
  open: boolean;
  streamPubkey: string;
  streamId: string;
  broadcasterName?: string;
  paymentMethods?: StreamPaymentMethod[];
  onClose: () => void;
}

function paymentMethodKey(method: StreamPaymentMethod, index: number): string {
  return `${method.asset}|${method.network ?? ""}|${method.address}|${index}`;
}

export function UnifiedTipDialog({
  open,
  streamPubkey,
  streamId,
  broadcasterName,
  paymentMethods,
  onClose
}: UnifiedTipDialogProps) {
  const profileRecord = useNostrProfile(streamPubkey);
  const [showMonero, setShowMonero] = useState(false);
  const [copyStateByKey, setCopyStateByKey] = useState<Record<string, "idle" | "copied" | "error">>({});

  const resolvedPaymentMethods = useMemo(
    () => paymentMethods ?? paymentMethodsFromProfile(profileRecord?.profile),
    [paymentMethods, profileRecord?.profile]
  );
  const publicXmrMethods = useMemo(
    () => resolvedPaymentMethods.filter((method) => method.asset === "xmr"),
    [resolvedPaymentMethods]
  );
  const paymentRailGroups = useMemo(
    () => groupPaymentMethodsByRail(resolvedPaymentMethods.filter((method) => method.asset !== "xmr")),
    [resolvedPaymentMethods]
  );

  const copyPaymentAddress = useCallback(async (key: string, address: string) => {
    setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(address);
      setCopyStateByKey((prev) => ({ ...prev, [key]: "copied" }));
      setTimeout(() => {
        setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
      }, 1200);
    } catch {
      setCopyStateByKey((prev) => ({ ...prev, [key]: "error" }));
      setTimeout(() => {
        setCopyStateByKey((prev) => ({ ...prev, [key]: "idle" }));
      }, 1800);
    }
  }, []);

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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900/50 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-100">
              <span className="text-yellow-500">💎</span> Support Creator
            </h3>
            {broadcasterName ? <p className="mt-0.5 text-xs text-neutral-400">To {broadcasterName}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-neutral-400 transition-colors hover:bg-neutral-800">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center overflow-y-auto p-6">
          {resolvedPaymentMethods.length > 0 ? (
            <div className="w-full space-y-4">
              {publicXmrMethods.map((method, index) => {
                const methodKey = paymentMethodKey(method, index);
                const walletUri = buildPaymentUri(method);
                return (
                  <div key={methodKey} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">Monero</div>
                        <div className="text-xs text-neutral-500">{method.label?.trim() || "Public payout address"}</div>
                      </div>
                      <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-300">
                        XMR
                      </span>
                    </div>
                    <div className="mt-3 break-all rounded-xl border border-neutral-800 bg-black/40 px-3 py-2 font-mono text-[11px] text-neutral-300">
                      {method.address}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {walletUri ? (
                        <a
                          href={walletUri}
                          className="min-w-[9rem] flex-1 rounded-xl bg-orange-500 px-3 py-2 text-center text-sm font-semibold text-orange-950 transition-colors hover:bg-orange-400"
                        >
                          Open Wallet
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void copyPaymentAddress(methodKey, method.address)}
                        className="min-w-[7rem] flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800"
                      >
                        {copyStateByKey[methodKey] === "copied"
                          ? "Copied"
                          : copyStateByKey[methodKey] === "error"
                            ? "Copy failed"
                            : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })}

              {paymentRailGroups.map(({ rail, methods }) => (
                <div key={rail.id} className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">{rail.name}</div>
                      <div className="text-xs text-neutral-500">{rail.description}</div>
                    </div>
                    <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      {rail.execution === "verified_backend" ? "verified" : "handoff"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {methods.map((method, index) => {
                      const methodKey = paymentMethodKey(method, index);
                      const walletUri = buildPaymentUri(method);
                      const assetMeta = PAYMENT_ASSET_META[method.asset];
                      const descriptor = [method.label, method.network, method.amount ? `${method.amount} ${assetMeta.symbol}` : null]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={methodKey} className="rounded-xl border border-neutral-800 bg-black/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-neutral-100">{assetMeta.name}</div>
                              <div className="text-xs text-neutral-500">{descriptor || "Wallet rail"}</div>
                            </div>
                            <span className="rounded-full border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-300">
                              {assetMeta.symbol}
                            </span>
                          </div>
                          <div className="mt-2 break-all rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 font-mono text-[11px] text-neutral-300">
                            {method.address}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {walletUri ? (
                              <a
                                href={walletUri}
                                className="min-w-[9rem] flex-1 rounded-xl bg-neutral-200 px-3 py-2 text-center text-sm font-semibold text-neutral-950 transition-colors hover:bg-white"
                              >
                                Open Wallet
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void copyPaymentAddress(methodKey, method.address)}
                              className="min-w-[7rem] flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800"
                            >
                              {copyStateByKey[methodKey] === "copied"
                                ? "Copied"
                                : copyStateByKey[methodKey] === "error"
                                  ? "Copy failed"
                                  : "Copy"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex w-full flex-col items-center py-4 text-center text-neutral-500">
              <svg className="mb-3 h-10 w-10 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">This creator does not have any supported payment rails configured for this surface.</p>
            </div>
          )}

          <div className="my-6 h-px w-full bg-neutral-800/60" />

          <div className="flex w-full flex-col items-center pb-2 text-center">
            <p className="mb-3 max-w-[260px] text-xs text-neutral-500">
              Or generate a temporary dStream escrow address that never exposes your public payout address.
            </p>
            <button
              onClick={() => setShowMonero(true)}
              className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 transition-colors hover:bg-neutral-700"
            >
              <span className="font-black text-orange-500">XMR</span> Private Proxy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
