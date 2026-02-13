import { BookOpenText, Heart, Sparkles } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-800/80 bg-neutral-950">
      <div className="max-w-7xl mx-auto px-6 py-10 grid gap-8 md:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <img src="/logo_trimmed.png" alt="dStream logo" className="h-7 w-auto object-contain" />
            <span className="font-semibold tracking-tight">dStream Rebuild</span>
          </div>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Nostr-native live streaming with WHIP ingest, WHEP/HLS playback, and optional peer-assist over WebRTC.
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Protocol</p>
          <a href="/whitepaper" className="block text-neutral-300 hover:text-white transition-colors">
            Whitepaper
          </a>
          <a href="/docs" className="block text-neutral-300 hover:text-white transition-colors">
            Documentation
          </a>
          <a href="/use-cases" className="block text-neutral-300 hover:text-white transition-colors">
            Use Cases
          </a>
        </div>

        <div className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <a href="/donate" className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 transition-colors">
            <Heart className="w-4 h-4" />
            Donate
          </a>
          <a
            href="https://github.com/3KD/dStream"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-neutral-300 hover:text-white transition-colors"
          >
            GitHub
          </a>
          <p className="text-neutral-500 inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <BookOpenText className="w-4 h-4" />
            Updated for the current rebuild architecture
          </p>
        </div>
      </div>
    </footer>
  );
}
