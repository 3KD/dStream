import { useMemo } from "react";
import { PlugZap, ExternalLink } from "lucide-react";
import { WALLET_INTEGRATIONS, PAYMENT_ASSET_META, walletModeLabel, walletModeHint } from "@/lib/payments/types";

export function WalletIntegrationsInfo() {
  const walletIntegrationsByMode = useMemo(() => {
    const modes: Array<"native_app" | "browser_extension" | "external_cli"> = ["native_app", "browser_extension", "external_cli"];
    return modes.map((mode) => ({
      mode,
      wallets: WALLET_INTEGRATIONS.filter((wallet) => wallet.mode === mode)
    }));
  }, []);

  return (
    <section id="wallet-integrations" className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4 scroll-mt-24">
      <h2 className="text-sm font-semibold text-neutral-200 inline-flex items-center gap-2">
        <PlugZap className="w-4 h-4" />
        Wallet Integrations
      </h2>

      <div className="text-sm text-neutral-300 space-y-2">
        <p>
          This panel displays supported wallet behaviors. dStream never stores private keys; it only prepares addresses, URI links,
          and preferred-wallet hints.
        </p>
        <ol className="list-decimal pl-5 text-xs text-neutral-400 space-y-1">
          <li>Set preferred wallet per asset under Payment Defaults.</li>
          <li>Configure payout methods in Broadcast (core + advanced panel).</li>
          <li>On watch page, viewers use Copy / Wallet URI / Preferred wallet links for settlement.</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {walletIntegrationsByMode.map(({ mode, wallets }) => (
          <article key={mode} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">{walletModeLabel(mode)}</div>
              <div className="text-xs text-neutral-500 mt-1">{walletModeHint(mode)}</div>
            </div>
            <div className="space-y-2">
              {wallets.map((wallet) => (
                <div key={wallet.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-200">{wallet.name}</div>
                    <a
                      href={wallet.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                    >
                      Site <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Assets: {wallet.assets.map((asset) => PAYMENT_ASSET_META[asset].symbol).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="text-xs text-neutral-500">
        Prefer a CLI wallet workflow? Set preferred wallet to Monero CLI / Bitcoin Core, then use Copy on watch page to pay from your terminal wallet.
      </div>
    </section>
  );
}
