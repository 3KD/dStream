import Link from "next/link";
import { BookOpenText, ExternalLink, Heart, Network, ShieldCheck, Sparkles } from "lucide-react";
import { SupportAddressCopyChip } from "@/components/layout/SupportXmrAddress";
import { getSupportLinks } from "@/lib/support";

const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? "").trim();
const supportBtcAddress = (process.env.NEXT_PUBLIC_SUPPORT_BTC_ADDRESS ?? "").trim();
const supportEthAddress = (process.env.NEXT_PUBLIC_SUPPORT_ETH_ADDRESS ?? "").trim();
const supportTrxAddress = (process.env.NEXT_PUBLIC_SUPPORT_TRX_ADDRESS ?? "").trim();
const supportLinks = getSupportLinks();
const protocolLinks = [
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/docs", label: "Documentation" },
  { href: "/use-cases", label: "Use Cases" },
  { href: "/donate", label: "Donate" },
  { href: "/analytics", label: "Analytics" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/community-guidelines", label: "Community Guidelines" }
];
const buildLinks = [
  { href: "/broadcast", label: "Broadcast" },
  { href: "/browse", label: "Browse" },
  { href: "/settings", label: "Settings" },
  { href: "/mobile/bootstrap", label: "Mobile Bootstrap" }
];

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800/80 bg-neutral-950/95">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-6 sm:gap-7 xl:gap-8">
          <div className="col-span-2 xl:col-span-1 space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2">
              <img src="/logo_trimmed.png" alt="dStream logo" className="h-7 w-auto object-contain" />
              <span className="font-semibold tracking-tight">dStream Protocol</span>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed">
              World’s first decentralized streaming protocol. Built for people of the modern de-fi economy.
            </p>
            <p className="text-xs text-neutral-500 inline-flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <BookOpenText className="w-4 h-4" />
              Production docs reflect live stack behavior
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5" />
              Protocol
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {protocolLinks.map((item) => (
                <Link key={item.href} href={item.href} className="block text-neutral-300 hover:text-white transition-colors">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Build
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {buildLinks.map((item) => (
                <Link key={item.href} href={item.href} className="block text-neutral-300 hover:text-white transition-colors">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="col-span-2 xl:col-span-1 space-y-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href="/support" className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 transition-colors">
                Support Hub
              </Link>
              <Link href="/donate" className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 transition-colors">
                <Heart className="w-4 h-4" />
                Donate
              </Link>
              <a
                href={supportLinks.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-neutral-300 hover:text-white transition-colors"
              >
                GitHub
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            {supportXmrAddress && <SupportAddressCopyChip label="XMR" address={supportXmrAddress} ariaLabel="Copy Monero support address" />}
            {supportBtcAddress && <SupportAddressCopyChip label="BTC" address={supportBtcAddress} ariaLabel="Copy Bitcoin support address" />}
            {supportEthAddress && <SupportAddressCopyChip label="ETH" address={supportEthAddress} ariaLabel="Copy Ethereum support address" />}
            {supportTrxAddress && <SupportAddressCopyChip label="TRX" address={supportTrxAddress} ariaLabel="Copy TRON support address" />}
            <div className="text-[11px] text-neutral-500">Wallet plugin setup: Settings → Wallet Integrations</div>
            <Link href="/community-guidelines" className="text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors">
              Report abuse or policy violations
            </Link>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[11px] leading-relaxed text-neutral-400">
              Streams run on independent nodes. Node operators are responsible for what they broadcast or relay. dStream does not control third-party
              content and assumes no liability for it.
            </div>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 pt-4 border-t border-neutral-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-neutral-500">
          <span>© dStream</span>
          <span>Decentralized by default. Operated by independent nodes.</span>
        </div>
      </div>
    </footer>
  );
}
