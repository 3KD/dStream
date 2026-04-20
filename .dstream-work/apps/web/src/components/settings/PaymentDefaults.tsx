"use client";

import { useCallback, useEffect, useState } from "react";
import { useSocial } from "@/context/SocialContext";
import {
  PAYMENT_ASSET_ORDER,
  PAYMENT_ASSET_META,
  getWalletIntegrationsForAsset,
  type WalletIntegrationId
} from "@/lib/payments/catalog";
import {
  type PaymentMethodDraft,
  paymentMethodToDraft,
  createPaymentMethodDraft,
  validatePaymentMethodDrafts
} from "@/lib/payments/methods";
import { type StreamPaymentAsset } from "@dstream/protocol";

export function PaymentDefaults() {
  const social = useSocial();
  const settings = social.settings;

  const [defaultPaymentDrafts, setDefaultPaymentDrafts] = useState<PaymentMethodDraft[]>([]);
  const [defaultPaymentsError, setDefaultPaymentsError] = useState<string | null>(null);
  const [defaultPaymentsNotice, setDefaultPaymentsNotice] = useState<string | null>(null);

  useEffect(() => {
    setDefaultPaymentDrafts(settings.paymentDefaults.paymentMethods.map((method) => paymentMethodToDraft(method)));
  }, [settings.paymentDefaults.paymentMethods]);

  const updateDefaultPaymentDraft = useCallback((index: number, patch: Partial<PaymentMethodDraft>) => {
    setDefaultPaymentDrafts((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }, []);

  const removeDefaultPaymentDraft = useCallback((index: number) => {
    setDefaultPaymentDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const addDefaultPaymentDraft = useCallback(() => {
    setDefaultPaymentDrafts((prev) => [...prev, createPaymentMethodDraft()]);
  }, []);

  const saveDefaultPaymentMethods = useCallback(() => {
    const result = validatePaymentMethodDrafts(defaultPaymentDrafts);
    if (result.errors.length > 0) {
      setDefaultPaymentsError(result.errors[0] ?? "Invalid payment methods.");
      setDefaultPaymentsNotice(null);
      return;
    }
    social.updateSettings({
      paymentDefaults: {
        ...settings.paymentDefaults,
        paymentMethods: result.methods
      }
    });
    setDefaultPaymentsError(null);
    setDefaultPaymentsNotice(`Saved ${result.methods.length} payment method${result.methods.length === 1 ? "" : "s"}.`);
  }, [defaultPaymentDrafts, settings.paymentDefaults, social]);

  const updatePreferredWallet = useCallback(
    (asset: StreamPaymentAsset, walletIdRaw: string) => {
      const next = { ...(settings.paymentDefaults.preferredWalletByAsset ?? {}) };
      if (!walletIdRaw) {
        delete next[asset];
      } else {
        next[asset] = walletIdRaw as WalletIntegrationId;
      }
      social.updateSettings({
        paymentDefaults: {
          ...settings.paymentDefaults,
          preferredWalletByAsset: next
        }
      });
    },
    [settings.paymentDefaults, social]
  );

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-200">Payment Defaults</h2>
      <div className="grid grid-cols-1 gap-3">
        <label className="space-y-1">
          <div className="text-xs text-neutral-500">Default Monero tip address</div>
          <input
            value={settings.paymentDefaults.xmrTipAddress}
            onChange={(e) =>
              social.updateSettings({
                paymentDefaults: { ...settings.paymentDefaults, xmrTipAddress: e.target.value }
              })
            }
            placeholder="4..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="text-xs text-neutral-500">Default stake requirement (XMR)</div>
            <input
              value={settings.paymentDefaults.stakeXmr}
              onChange={(e) =>
                social.updateSettings({
                  paymentDefaults: { ...settings.paymentDefaults, stakeXmr: e.target.value }
                })
              }
              placeholder="0.05"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-neutral-500">Default stake note</div>
            <input
              value={settings.paymentDefaults.stakeNote}
              onChange={(e) =>
                social.updateSettings({
                  paymentDefaults: { ...settings.paymentDefaults, stakeNote: e.target.value }
                })
              }
              placeholder="Optional message shown to viewers"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-200"
            />
          </label>
        </div>
      </div>

      <div className="pt-3 border-t border-neutral-800 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">Default additional payout methods (for non-XMR assets)</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addDefaultPaymentDraft}
              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
            >
              Add method
            </button>
            <button
              type="button"
              onClick={saveDefaultPaymentMethods}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
            >
              Save methods
            </button>
          </div>
        </div>

        {defaultPaymentDrafts.length === 0 ? (
          <div className="text-xs text-neutral-500">No extra payout methods configured.</div>
        ) : (
          <div className="space-y-2">
            {defaultPaymentDrafts.map((row, index) => (
              <div key={`payment-default-${index}`} className="grid grid-cols-1 lg:grid-cols-[120px_1fr_130px_130px_130px_auto] gap-2">
                <select
                  value={row.asset}
                  onChange={(e) => updateDefaultPaymentDraft(index, { asset: e.target.value as StreamPaymentAsset })}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-xs text-neutral-200"
                >
                  {PAYMENT_ASSET_ORDER.map((asset) => (
                    <option key={asset} value={asset}>
                      {PAYMENT_ASSET_META[asset].symbol}
                    </option>
                  ))}
                </select>
                <input
                  value={row.address}
                  onChange={(e) => updateDefaultPaymentDraft(index, { address: e.target.value })}
                  placeholder={PAYMENT_ASSET_META[row.asset].placeholder}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200"
                />
                <input
                  value={row.network}
                  onChange={(e) => updateDefaultPaymentDraft(index, { network: e.target.value })}
                  placeholder="network"
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200"
                />
                <input
                  value={row.label}
                  onChange={(e) => updateDefaultPaymentDraft(index, { label: e.target.value })}
                  placeholder="label"
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200"
                />
                <input
                  value={row.amount}
                  onChange={(e) => updateDefaultPaymentDraft(index, { amount: e.target.value })}
                  placeholder={row.asset === "btc" ? "amount (btc/sats)" : "amount (optional)"}
                  className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200"
                />
                <button
                  type="button"
                  onClick={() => removeDefaultPaymentDraft(index)}
                  className="px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-200"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {defaultPaymentsNotice && <div className="text-xs text-green-300">{defaultPaymentsNotice}</div>}
        {defaultPaymentsError && <div className="text-xs text-red-300">{defaultPaymentsError}</div>}
      </div>

      <div className="pt-3 border-t border-neutral-800 space-y-2">
        <div className="text-xs text-neutral-500">Preferred wallet per asset</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {PAYMENT_ASSET_ORDER.map((asset) => {
            const supported = getWalletIntegrationsForAsset(asset);
            return (
              <label key={`wallet-pref-${asset}`} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2 space-y-1">
                <div className="text-xs text-neutral-400">{PAYMENT_ASSET_META[asset].symbol}</div>
                <select
                  value={settings.paymentDefaults.preferredWalletByAsset[asset] ?? ""}
                  onChange={(e) => updatePreferredWallet(asset, e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs text-neutral-200"
                >
                  <option value="">No preference</option>
                  {supported.map((wallet) => (
                    <option key={`${asset}-${wallet.id}`} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-neutral-500">Applied to new broadcasts and available for wallet actions on watch pages.</div>
    </section>
  );
}
