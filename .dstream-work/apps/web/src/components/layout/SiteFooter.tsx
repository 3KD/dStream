import Link from "next/link";
import { BookOpenText, ExternalLink, Heart, Network, ShieldCheck, Sparkles, Download, Monitor, Smartphone, Terminal } from "lucide-react";
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
    <footer id="global-site-footer" className="border-t border-neutral-800/80 bg-neutral-950/95 relative z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-6 sm:gap-7 xl:gap-8">
          
          <div className="col-span-2 md:col-span-4 xl:col-span-3 space-y-3 sm:space-y-4">
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

          <div className="col-span-1 xl:col-span-2 space-y-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5" />
              Protocol
            </p>
            <div className="grid grid-cols-1 gap-1.5 mt-2">
              {protocolLinks.map((item) => (
                <Link key={item.href} href={item.href} className="block text-neutral-300 hover:text-white transition-colors">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="col-span-1 xl:col-span-2 space-y-2 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Build
            </p>
            <div className="grid grid-cols-1 gap-1.5 mt-2">
              {buildLinks.map((item) => (
                <Link key={item.href} href={item.href} className="block text-neutral-300 hover:text-white transition-colors">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="col-span-2 xl:col-span-2 space-y-3 text-sm">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
            <div className="flex flex-col gap-2">
              <Link href="/support" className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 transition-colors">
                Support Hub
              </Link>
              <Link href="/donate" className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 transition-colors">
                <Heart className="w-4 h-4" />
                Donate
              </Link>
            </div>
            <div className="space-y-1.5 mt-2 rounded-lg border border-neutral-800/60 bg-neutral-900/30 p-2">
              {supportXmrAddress && <SupportAddressCopyChip label="XMR" address={supportXmrAddress} ariaLabel="Copy Monero support address" />}
              {supportBtcAddress && <SupportAddressCopyChip label="BTC" address={supportBtcAddress} ariaLabel="Copy Bitcoin support address" />}
              {supportEthAddress && <SupportAddressCopyChip label="ETH" address={supportEthAddress} ariaLabel="Copy Ethereum support address" />}
              {supportTrxAddress && <SupportAddressCopyChip label="TRX" address={supportTrxAddress} ariaLabel="Copy Tron support address" />}
              <div className="text-[10px] text-neutral-500 pt-1 border-t border-neutral-800">Support addresses</div>
            </div>
            <div className="text-[11px] text-neutral-500 pt-1">Wallet setup: Settings → Wallet Integrations</div>
          </div>

          <div className="col-span-2 md:col-span-4 xl:col-span-3">
            <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/30 via-neutral-900/90 to-blue-900/20 p-5 shadow-lg shadow-purple-900/10 h-full flex flex-col justify-between">
              
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none"></div>
              
              <div className="space-y-2 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold uppercase tracking-wider border border-purple-500/30 mb-2">
                  <Terminal className="w-3 h-3" /> Node Runner
                </div>
                <h3 className="text-lg font-bold text-white leading-tight">&gt;_ Run your own decentralized dStream node!</h3>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  dStream is unstoppable when users spin up their own localized Nodes. Download the pre-compiled architecture directly to your environment.
                </p>
              </div>

              <div className="mt-5 space-y-2 relative z-10">
                <Link 
                  href="https://github.com/3KD/dStream/releases" 
                  target="_blank"
                  className="flex items-center justify-between w-full px-3 py-2 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded-lg transition-all"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                    <Monitor className="w-4 h-4 text-neutral-400" />
                    Desktop Nodes
                  </div>
                  <div className="flex -space-x-1">
                    <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 border border-neutral-700">macOS</span>
                    <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 border border-neutral-700">Windows</span>
                    <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 border border-neutral-700">Linux</span>
                  </div>
                </Link>

                <Link 
                  href="https://github.com/3KD/dStream/releases" 
                  target="_blank"
                  className="flex items-center justify-between w-full px-3 py-2 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded-lg transition-all"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                    <Smartphone className="w-4 h-4 text-neutral-400" />
                    Mobile Wrappers
                  </div>
                  <div className="flex -space-x-1">
                    <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 border border-neutral-700">iOS</span>
                    <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 border border-neutral-700">Android</span>
                  </div>
                </Link>
                
                <Link
                  href="https://github.com/3KD/dStream"
                  target="_blank"
                  className="mt-2 flex w-full items-center justify-center gap-2 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                >
                  <Download className="w-4 h-4" />
                  Clone the Source
                </Link>

              </div>
            </div>
          </div>

        </div>

        <div className="mt-10 sm:mt-12 pt-6 border-t border-neutral-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-neutral-500">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-neutral-400">© dStream Protocol</span>
            <span>Decentralized by default. Operated by independent nodes.</span>
          </div>
          <div className="max-w-xs text-right opacity-60 hover:opacity-100 transition-opacity">
            Streams run on independent nodes. Node operators are responsible for what they broadcast or relay. 
            dStream assumes no liability for decentralized third-party content.
          </div>
        </div>
      </div>
    </footer>
  );
}
