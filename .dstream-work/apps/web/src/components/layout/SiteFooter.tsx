import Link from "next/link";
import { BookOpenText, ExternalLink, Heart, Network, ShieldCheck, Sparkles } from "lucide-react";
import { SupportXmrAddress } from "@/components/layout/SupportXmrAddress";

const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? "").trim();

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800/80 bg-neutral-950/95">
      <div className="max-w-7xl mx-auto px-6 py-10 grid gap-8 md:grid-cols-4">
        <div className="space-y-4 md:col-span-1">
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
          <Link href="/whitepaper" className="block text-neutral-300 hover:text-white transition-colors">
            Whitepaper
          </Link>
          <Link href="/docs" className="block text-neutral-300 hover:text-white transition-colors">
            Documentation
          </Link>
          <Link href="/use-cases" className="block text-neutral-300 hover:text-white transition-colors">
            Use Cases
          </Link>
          <Link href="/donate" className="block text-neutral-300 hover:text-white transition-colors">
            Donate
          </Link>
          <Link href="/analytics" className="block text-neutral-300 hover:text-white transition-colors">
            Analytics
          </Link>
          <Link href="/terms" className="block text-neutral-300 hover:text-white transition-colors">
            Terms
          </Link>
          <Link href="/privacy" className="block text-neutral-300 hover:text-white transition-colors">
            Privacy
          </Link>
          <Link href="/community-guidelines" className="block text-neutral-300 hover:text-white transition-colors">
            Community Guidelines
          </Link>
        </div>

        <div className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Build
          </p>
          <Link href="/broadcast" className="block text-neutral-300 hover:text-white transition-colors">
            Broadcast
          </Link>
          <Link href="/browse" className="block text-neutral-300 hover:text-white transition-colors">
            Browse
          </Link>
          <Link href="/settings" className="block text-neutral-300 hover:text-white transition-colors">
            Settings
          </Link>
          <Link href="/profile" className="block text-neutral-300 hover:text-white transition-colors">
            Profile
          </Link>
          <Link href="/mobile/bootstrap" className="block text-neutral-300 hover:text-white transition-colors">
            Mobile Bootstrap
          </Link>
        </div>

        <div className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <Link href="/donate" className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 transition-colors">
            <Heart className="w-4 h-4" />
            Donate
          </Link>
          {supportXmrAddress && <SupportXmrAddress address={supportXmrAddress} />}
          <div className="text-[11px] text-neutral-500">Wallet plugin setup: Settings → Wallet Integrations</div>
          <Link href="/community-guidelines" className="text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors">
            Report abuse or policy violations
          </Link>
          <a
            href="https://github.com/3KD/dStream"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-neutral-300 hover:text-white transition-colors"
          >
            GitHub
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[11px] leading-relaxed text-neutral-400">
            Streams run on independent nodes. Node operators are responsible for what they broadcast or relay. dStream does not control third-party
            content and assumes no liability for it.
          </div>
        </div>
      </div>
    </footer>
  );
}
