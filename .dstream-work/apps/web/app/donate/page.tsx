import Link from "next/link";
import { Copy, Heart, Wallet } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SupportAddressCopyChip } from "@/components/layout/SupportXmrAddress";

const fallbackSupportXmrAddress =
  "49zL3oidgJbD6DeMheen873myfW1Jkp2tHiQJWXD7L64gjMjQ2pjFmjeksziP3CGKA1rfeLMCtgEqbUWBmhzL9YGP6X5w42";
const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? fallbackSupportXmrAddress).trim();
const supportBtcAddress = (process.env.NEXT_PUBLIC_SUPPORT_BTC_ADDRESS ?? "").trim();
const supportBtcLightning = (process.env.NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING ?? "").trim();
const supportEthAddress = (process.env.NEXT_PUBLIC_SUPPORT_ETH_ADDRESS ?? "").trim();
const supportTrxAddress = (process.env.NEXT_PUBLIC_SUPPORT_TRX_ADDRESS ?? "").trim();

export default function DonatePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <h1 className="text-4xl font-black tracking-tight inline-flex items-center gap-3">
            <Heart className="w-9 h-9 text-rose-400" />
            Donate to dStream
          </h1>
          <p className="text-neutral-300 max-w-3xl">
            dStream is designed to be self-hostable and decentralized. Support keeps protocol work, testing, and infrastructure moving.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold inline-flex items-center gap-2">
            <Wallet className="w-6 h-6 text-orange-400" />
            Monero Support Address
          </h2>

          <p className="text-sm text-neutral-400">Send XMR directly to:</p>
          <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportXmrAddress}</p>
          <p className="text-xs text-neutral-500 inline-flex items-center gap-2">
            <Copy className="w-4 h-4" />
            Copy from your wallet client to avoid transcription errors.
          </p>
          <p className="text-xs text-neutral-500">
            Address source: <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_XMR_ADDRESS</span> (falls back to default support
            address when unset).
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold inline-flex items-center gap-2">
            <Wallet className="w-6 h-6 text-amber-400" />
            Bitcoin Support Address
          </h2>
          {supportBtcAddress ? (
            <>
              <p className="text-sm text-neutral-400">Send BTC directly to:</p>
              <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportBtcAddress}</p>
              <SupportAddressCopyChip label="BTC" address={supportBtcAddress} ariaLabel="Copy Bitcoin support address" />
            </>
          ) : (
            <p className="text-sm text-neutral-400">
              This deployment does not currently expose a BTC support address.
            </p>
          )}

          {supportBtcLightning ? (
            <div className="space-y-2">
              <p className="text-sm text-neutral-400">Lightning (optional):</p>
              <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportBtcLightning}</p>
              <SupportAddressCopyChip label="LN" address={supportBtcLightning} ariaLabel="Copy Lightning support address" />
            </div>
          ) : null}

          <p className="text-xs text-neutral-500">
            Address sources: <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_BTC_ADDRESS</span> and{" "}
            <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING</span>.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold inline-flex items-center gap-2">
            <Wallet className="w-6 h-6 text-violet-400" />
            Ethereum Support Address
          </h2>
          {supportEthAddress ? (
            <>
              <p className="text-sm text-neutral-400">Send ETH (and EVM tokens) to:</p>
              <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportEthAddress}</p>
              <SupportAddressCopyChip label="ETH" address={supportEthAddress} ariaLabel="Copy Ethereum support address" />
            </>
          ) : (
            <p className="text-sm text-neutral-400">This deployment does not currently expose an ETH support address.</p>
          )}
          <p className="text-xs text-neutral-500">
            Address source: <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_ETH_ADDRESS</span>.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold inline-flex items-center gap-2">
            <Wallet className="w-6 h-6 text-cyan-400" />
            TRON Support Address
          </h2>
          {supportTrxAddress ? (
            <>
              <p className="text-sm text-neutral-400">Send TRX to:</p>
              <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportTrxAddress}</p>
              <SupportAddressCopyChip label="TRX" address={supportTrxAddress} ariaLabel="Copy TRON support address" />
            </>
          ) : (
            <p className="text-sm text-neutral-400">This deployment does not currently expose a TRX support address.</p>
          )}
          <p className="text-xs text-neutral-500">
            Address source: <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_TRX_ADDRESS</span>.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3 text-sm text-neutral-300">
          <h2 className="text-2xl font-bold">Where support goes</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Protocol hardening (WHIP/WHEP/HLS path reliability and integrity checks).</li>
            <li>Relay, TURN, and wallet-rpc operations coverage.</li>
            <li>End-to-end testing across Chrome/Firefox and multi-network scenarios.</li>
            <li>Maintenance of docs, ADRs, and deployment runbooks.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3 text-sm text-neutral-300">
          <h2 className="text-2xl font-bold">Wallet Plugin Guidance</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Set preferred wallet per asset in Settings → Wallet Integrations.</li>
            <li>Use watch-page wallet URI actions for compatible assets and wallet apps.</li>
            <li>Use copy-address mode for CLI/external signing flows.</li>
          </ul>
          <div className="pt-2 flex flex-wrap gap-3">
            <Link href="/settings#wallet-integrations" className="text-blue-400 hover:text-blue-300">
              Open wallet integrations
            </Link>
            <Link href="/docs" className="text-blue-400 hover:text-blue-300">
              Read technical docs
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3 text-sm text-neutral-300">
          <h2 className="text-2xl font-bold">Other Ways to Help</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Tip streamers directly from watch pages (Monero panel).</li>
            <li>Run smoke suites and report regressions with logs.</li>
            <li>Host your own relays/origin nodes and contribute hardening feedback.</li>
          </ul>
          <div className="pt-2 flex flex-wrap gap-3">
            <Link href="/docs" className="text-blue-400 hover:text-blue-300">
              Read deployment and architecture docs
            </Link>
            <Link href="/whitepaper" className="text-blue-400 hover:text-blue-300">
              Open whitepaper
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
