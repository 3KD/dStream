import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Documentation</p>
          <h1 className="text-4xl font-black tracking-tight">dStream Rebuild Docs</h1>
          <p className="text-neutral-300 max-w-3xl">
            This page describes the current build that is running in this repository: Nostr identity/discovery, WHIP ingest, WHEP
            playback, HLS fallback, optional P2P assist, Monero tip/stake flows, and the shipped social surfaces.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Architecture</h2>
          <ul className="text-sm text-neutral-300 space-y-2 list-disc pl-5">
            <li>
              <span className="text-neutral-100 font-semibold">Control plane:</span> Nostr relays for stream announce (`kind 30311`),
              chat, presence, and P2P signaling.
            </li>
            <li>
              <span className="text-neutral-100 font-semibold">Media ingest:</span> WHIP/WebRTC to MediaMTX-compatible origin.
            </li>
            <li>
              <span className="text-neutral-100 font-semibold">Playback:</span> WHEP preferred when available, automatic HLS fallback.
            </li>
            <li>
              <span className="text-neutral-100 font-semibold">Scale assist:</span> HLS segment peer-assist over WebRTC data channels,
              with origin fallback always available.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Shipped Surfaces</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl border border-neutral-800 p-4 space-y-2">
              <p className="font-semibold text-neutral-100">Core</p>
              <p className="text-neutral-300">`/broadcast`, `/watch/:npub/:streamId`, `/browse`, `/dashboard`</p>
            </div>
            <div className="rounded-xl border border-neutral-800 p-4 space-y-2">
              <p className="font-semibold text-neutral-100">Social</p>
              <p className="text-neutral-300">`/inbox`, `/guilds`, `/moderation`, `/profile`, `/settings`</p>
            </div>
            <div className="rounded-xl border border-neutral-800 p-4 space-y-2">
              <p className="font-semibold text-neutral-100">Monero + Escrow</p>
              <p className="text-neutral-300">Verified tips, stake sessions, refunds/slash flows, escrow-v3 coordination APIs</p>
            </div>
            <div className="rounded-xl border border-neutral-800 p-4 space-y-2">
              <p className="font-semibold text-neutral-100">Operations</p>
              <p className="text-neutral-300">Docker stack, hardening checks, wallet-capability and e2e smoke suites</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Important Boundaries</h2>
          <ul className="text-sm text-neutral-300 space-y-2 list-disc pl-5">
            <li>Stream identity is canonical as `(pubkeyHex, streamId)`; user-facing routes use `npub` for safety.</li>
            <li>P2P assist is default-on, but origin bootstrap/fallback remains required for reliability.</li>
            <li>Escrow-v3 is multisig coordination + origin-enforced settlement; it is not an on-chain trustless contract.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <h2 className="text-2xl font-bold mb-4">Primary Reading</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/whitepaper" className="px-4 py-2 rounded-full bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30">
              Whitepaper
            </Link>
            <Link href="/use-cases" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">
              Use Cases
            </Link>
            <Link href="/donate" className="px-4 py-2 rounded-full bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30">
              Donate
            </Link>
            <a
              href="https://github.com/3KD/dStream"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500"
            >
              GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
