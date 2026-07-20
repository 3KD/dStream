import Link from "next/link";
import type { StreamPaymentAsset, StreamPaymentMethod } from "@dstream/protocol";
import { Heart, ShieldCheck } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { DonationWalletCard } from "@/components/payments/DonationWalletCard";
import { PAYMENT_ASSET_META, buildPaymentUri } from "@/lib/payments/catalog";
import { validatePaymentAddress } from "@/lib/payments/methods";

const fallbackSupportXmrAddress =
  "49zL3oidgJbD6DeMheen873myfW1Jkp2tHiQJWXD7L64gjMjQ2pjFmjeksziP3CGKA1rfeLMCtgEqbUWBmhzL9YGP6X5w42";
const fallbackSupportBtcAddress = "bc1qtldhxtrcahn0xlxxydfaf4czww0rdmaeltyca9";
const fallbackSupportEthAddress = "0xEBC2943b39fbb47a461C21aaB49c482CF23e0699";
const fallbackSupportTrxAddress = "TH5oqaJWYnVZCCPktHvcsm8aaPUeAXzrTY";
const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? fallbackSupportXmrAddress).trim();
const supportBtcAddress = (process.env.NEXT_PUBLIC_SUPPORT_BTC_ADDRESS ?? fallbackSupportBtcAddress).trim();
const supportBtcLightning = (process.env.NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING ?? "").trim();
const supportEthAddress = (process.env.NEXT_PUBLIC_SUPPORT_ETH_ADDRESS ?? fallbackSupportEthAddress).trim();
const supportTrxAddress = (process.env.NEXT_PUBLIC_SUPPORT_TRX_ADDRESS ?? fallbackSupportTrxAddress).trim();
const supportSolAddress = (process.env.NEXT_PUBLIC_SUPPORT_SOL_ADDRESS ?? "").trim();
const supportXrpAddress = (process.env.NEXT_PUBLIC_SUPPORT_XRP_ADDRESS ?? "").trim();
const supportDogeAddress = (process.env.NEXT_PUBLIC_SUPPORT_DOGE_ADDRESS ?? "").trim();
const supportBchAddress = (process.env.NEXT_PUBLIC_SUPPORT_BCH_ADDRESS ?? "").trim();
const supportAdaAddress = (process.env.NEXT_PUBLIC_SUPPORT_ADA_ADDRESS ?? "").trim();

interface SupportPayment {
  method: StreamPaymentMethod;
  name: string;
  networkLabel: string;
  symbolClassName: string;
  walletUri: string;
  walletLabel: string;
}

function supportPayment(
  asset: StreamPaymentAsset,
  address: string,
  network: string,
  networkLabel: string,
  symbolClassName: string,
  label = "dStream",
  walletLabel = "Configured wallet"
): SupportPayment | null {
  if (!address) return null;

  const addressError = validatePaymentAddress(asset, address, network);
  if (addressError) {
    throw new Error(`Invalid ${asset.toUpperCase()} support address: ${addressError}`);
  }

  const method: StreamPaymentMethod = { asset, address, network, label };
  const walletUri = buildPaymentUri(method);
  if (!walletUri) throw new Error(`No wallet URI is configured for ${asset.toUpperCase()} support.`);

  return { method, name: PAYMENT_ASSET_META[asset].name, networkLabel, symbolClassName, walletUri, walletLabel };
}

const configuredPayments = [
  supportPayment("xmr", supportXmrAddress, "mainnet", "Monero mainnet", "bg-orange-600", "dStream", "Cake Wallet"),
  supportPayment("btc", supportBtcAddress, "bitcoin", "Bitcoin mainnet", "bg-amber-500", "dStream", "Cake Wallet"),
  supportPayment("btc", supportBtcLightning, "lightning", "Bitcoin Lightning", "bg-yellow-500", "dStream Lightning"),
  supportPayment("eth", supportEthAddress, "ethereum", "Ethereum mainnet", "bg-indigo-600", "dStream", "Cake Wallet"),
  supportPayment("usdt", supportEthAddress, "ethereum", "USDT on Ethereum", "bg-emerald-600", "dStream", "Cake Wallet"),
  supportPayment("usdc", supportEthAddress, "ethereum", "USDC on Ethereum", "bg-blue-600", "dStream", "Cake Wallet"),
  supportPayment("pepe", supportEthAddress, "ethereum", "PEPE on Ethereum", "bg-lime-700", "dStream", "Cake Wallet"),
  supportPayment("trx", supportTrxAddress, "tron", "TRON mainnet", "bg-red-600", "dStream", "Cake Wallet"),
  supportPayment("usdt", supportTrxAddress, "tron", "USDT on TRON", "bg-teal-600", "dStream", "Cake Wallet"),
  supportPayment("sol", supportSolAddress, "solana", "Solana mainnet", "bg-violet-600"),
  supportPayment("usdc", supportSolAddress, "solana", "USDC on Solana", "bg-cyan-600"),
  supportPayment("usdt", supportSolAddress, "solana", "USDT on Solana", "bg-teal-700"),
  supportPayment("xrp", supportXrpAddress, "xrpl", "XRP Ledger mainnet", "bg-neutral-700"),
  supportPayment("doge", supportDogeAddress, "dogecoin", "Dogecoin mainnet", "bg-yellow-600"),
  supportPayment("bch", supportBchAddress, "bitcoincash", "Bitcoin Cash mainnet", "bg-green-700"),
  supportPayment("ada", supportAdaAddress, "cardano", "Cardano mainnet", "bg-blue-700")
].filter((payment): payment is SupportPayment => payment !== null);

const missingRails = [
  !supportBtcLightning ? "Lightning" : null,
  !supportSolAddress ? "Solana / SPL" : null,
  !supportXrpAddress ? "XRP Ledger" : null,
  !supportDogeAddress ? "Dogecoin" : null,
  !supportBchAddress ? "Bitcoin Cash" : null,
  !supportAdaAddress ? "Cardano" : null
].filter((label): label is string => !!label);

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
              walletLabel={payment.walletLabel}
            />
          ))}
        </section>

        {missingRails.length > 0 ? (
          <section className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            Receive address pending: {missingRails.join(", ")}.
          </section>
        ) : null}

        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-6 text-sm text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex max-w-2xl items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Match the asset and network shown above. dStream will never ask for your wallet seed phrase or private key.
          </p>
          <div className="flex shrink-0 gap-4">
            <Link href="/settings/monetization#wallet-integrations" className="text-blue-400 hover:text-blue-300">
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
