import Link from "next/link";
import type { StreamPaymentAsset, StreamPaymentMethod } from "@dstream/protocol";
import { Heart, ShieldCheck } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { DonationWalletCard } from "@/components/payments/DonationWalletCard";
import { PAYMENT_ASSET_META, buildPaymentUri } from "@/lib/payments/catalog";
import { validatePaymentAddress } from "@/lib/payments/methods";

const fallbackSupportXmrAddress =
  "49zL3oidgJbD6DeMheen873myfW1Jkp2tHiQJWXD7L64gjMjQ2pjFmjeksziP3CGKA1rfeLMCtgEqbUWBmhzL9YGP6X5w42";
const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? fallbackSupportXmrAddress).trim();
const supportBtcAddress = (process.env.NEXT_PUBLIC_SUPPORT_BTC_ADDRESS ?? "").trim();
const supportBtcLightning = (process.env.NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING ?? "").trim();
const supportEthAddress = (process.env.NEXT_PUBLIC_SUPPORT_ETH_ADDRESS ?? "").trim();
const supportTrxAddress = (process.env.NEXT_PUBLIC_SUPPORT_TRX_ADDRESS ?? "").trim();

interface SupportPayment {
  method: StreamPaymentMethod;
  name: string;
  networkLabel: string;
  symbolClassName: string;
  walletUri: string;
}

function supportPayment(
  asset: StreamPaymentAsset,
  address: string,
  network: string,
  networkLabel: string,
  symbolClassName: string,
  label = "dStream"
): SupportPayment | null {
  if (!address) return null;

  const addressError = validatePaymentAddress(asset, address, network);
  if (addressError) {
    throw new Error(`Invalid ${asset.toUpperCase()} support address: ${addressError}`);
  }

  const method: StreamPaymentMethod = { asset, address, network, label };
  const walletUri = buildPaymentUri(method);
  if (!walletUri) throw new Error(`No wallet URI is configured for ${asset.toUpperCase()} support.`);

  return { method, name: PAYMENT_ASSET_META[asset].name, networkLabel, symbolClassName, walletUri };
}

const configuredPayments = [
  supportPayment("xmr", supportXmrAddress, "mainnet", "Monero mainnet", "bg-orange-600"),
  supportPayment("btc", supportBtcAddress, "bitcoin", "Bitcoin mainnet", "bg-amber-500"),
  supportPayment("btc", supportBtcLightning, "lightning", "Bitcoin Lightning", "bg-yellow-500", "dStream Lightning"),
  supportPayment("eth", supportEthAddress, "ethereum", "Ethereum mainnet", "bg-indigo-600"),
  supportPayment("trx", supportTrxAddress, "tron", "TRON mainnet", "bg-red-600")
].filter((payment): payment is SupportPayment => payment !== null);

const configuredAssets = new Set(configuredPayments.map((payment) => payment.method.asset));
const missingAssets = (["xmr", "btc", "eth", "trx"] as const).filter((asset) => !configuredAssets.has(asset));

export default function DonatePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <h1 className="inline-flex items-center gap-3 text-3xl font-black sm:text-4xl">
            <Heart className="h-8 w-8 text-rose-400 sm:h-9 sm:w-9" />
            Donate to dStream
          </h1>
          <p className="max-w-3xl text-neutral-300">
            Send directly to a dStream wallet. These addresses are non-custodial and support Cake Wallet QR scans and mobile wallet links.
          </p>
        </header>

        <section aria-label="Donation wallets" className="grid gap-4">
          {configuredPayments.map((payment) => (
            <DonationWalletCard
              key={`${payment.method.asset}:${payment.method.network}`}
              name={payment.name}
              symbol={PAYMENT_ASSET_META[payment.method.asset].symbol}
              network={payment.networkLabel}
              address={payment.method.address}
              walletUri={payment.walletUri}
              symbolClassName={payment.symbolClassName}
            />
          ))}
        </section>

        {missingAssets.length > 0 ? (
          <section className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            Wallet configuration pending: {missingAssets.map((asset) => PAYMENT_ASSET_META[asset].symbol).join(", ")}.
          </section>
        ) : null}

        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-6 text-sm text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex max-w-2xl items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Match the asset and network shown above. dStream will never ask for your wallet seed phrase or private key.
          </p>
          <div className="flex shrink-0 gap-4">
            <Link href="/settings#wallet-integrations" className="text-blue-400 hover:text-blue-300">
              Wallet settings
            </Link>
            <Link href="/docs" className="text-blue-400 hover:text-blue-300">
              Payment docs
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
