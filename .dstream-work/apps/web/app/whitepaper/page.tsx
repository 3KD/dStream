import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <article className="max-w-4xl mx-auto space-y-10">
          <header className="space-y-4 border-b border-neutral-800 pb-8">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Whitepaper · Rebuild Edition</p>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight">dStream Protocol Whitepaper</h1>
            <p className="text-neutral-300">
              This document describes the architecture, economic rails, and security boundaries of the currently shipped dStream runtime.
            </p>
            <div className="text-xs text-neutral-500 flex flex-wrap gap-4">
              <span>Date: February 14, 2026</span>
              <span>Status: Live implementation reference</span>
              <span>Scope: Production path (web + mobile shell + ops)</span>
            </div>
          </header>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Abstract</h2>
            <p className="text-neutral-300 leading-relaxed">
              dStream is a decentralized live-streaming protocol in which identity and coordination are relay-native (Nostr), media
              transport is replaceable (WHIP/WHEP/HLS), and payment rails remain user-owned (wallet-driven). The protocol separates
              coordination from transport so creators keep portable identity and audience continuity across infrastructure changes.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">1. System Model</h2>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
              <p>
                <span className="text-neutral-100 font-semibold">Control plane (Nostr):</span> stream announce (`kind 30311`), presence (`10312`),
                moderation/roles (`39317`/`39318`), chat (`1`), and private coordination (`4` / `20004`).
              </p>
              <p>
                <span className="text-neutral-100 font-semibold">Media plane:</span> broadcaster publishes through WHIP; playback resolves through
                WHEP first and HLS fallback.
              </p>
              <p>
                <span className="text-neutral-100 font-semibold">Assist plane:</span> P2P assist can exchange HLS bytes over WebRTC datachannels
                under host policy constraints.
              </p>
              <p>
                <span className="text-neutral-100 font-semibold">Value plane:</span> Monero verification uses wallet-rpc sessions; additional assets
                are direct payout rails with wallet URI integration.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">2. Canonical Identity and Routing</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Canonical key tuple: `(pubkeyHex, streamId)`.</li>
              <li>User-visible route uses NIP-19 (`npub`) and backend converts to hex.</li>
              <li>Watch route: `/watch/:npub/:streamId` with compatibility for hex pubkeys.</li>
              <li>Origin stream id rule: `${"{pubkeyHex}"}--${"{streamId}"}`.</li>
            </ul>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs font-mono text-neutral-300 overflow-x-auto">
              {`{
  "identity": "npub1...",
  "canonicalPubkey": "hex64",
  "streamId": "live-20260214-1730",
  "originStreamId": "hex64--live-20260214-1730"
}`}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">3. Broadcast and Playback Flows</h2>
            <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
              <li>Broadcaster captures camera/screen and publishes via WHIP.</li>
              <li>Broadcast page publishes a replaceable live announce event (`kind 30311`).</li>
              <li>Watch page resolves announce, builds preferred playback URL, and attempts WHEP.</li>
              <li>If WHEP is unavailable, playback fails over to HLS.</li>
              <li>P2P assist path activates only when host mode allows and stake requirements are satisfied.</li>
            </ol>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
              <div className="font-semibold text-neutral-100 mb-2">Host policy modes</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code>p2p_economy</code>: active rebroadcast set + queue thresholding; stake can gate assist role.
                </li>
                <li>
                  <code>host_only</code>: direct origin serving only; no rebroadcast queue incentives.
                </li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">4. Economic Rails and Wallet Integration</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Tip/session APIs support verified Monero transfer detection and confirmation status.</li>
              <li>Stake/session APIs support required stake checks and refund settlement route.</li>
              <li>Escrow-v3 APIs provide multisig coordination steps for participant/coordinator exchange.</li>
              <li>Additional assets (ETH/BTC/USDT/XRP/USDC/SOL/TRX/DOGE/BCH/ADA/PEPE) are payout methods with URI helpers.</li>
              <li>Wallet preferences are configured per asset in Settings and surfaced on watch page.</li>
            </ul>
            <p className="text-sm text-amber-300/90">
              Trust boundary: this implementation coordinates escrow policy in app/origin services; it is not a trustless generalized on-chain VM.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">5. Integrity, Moderation, and Safety</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Signed integrity manifests can be checked client-side with explicit verified/tampered state.</li>
              <li>Relay moderation events and local controls enforce mute/block/role policy in chat surfaces.</li>
              <li>NIP-05 policy can be required for elevated moderation and role management actions.</li>
              <li>Presence/assist state is advisory and does not replace origin access controls.</li>
              <li>Liability boundary: each node operator is responsible for content they publish or relay; dStream does not exercise editorial control over third-party broadcasts.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">6. API and Operations Profile</h2>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm text-neutral-300 space-y-2">
              <p>
                Runtime includes WHIP/WHEP/HLS proxy routes, payment catalog/validation endpoints, Monero verified tip/stake/escrow APIs,
                and operator scripts for hardening, runtime smoke checks, backup, and health monitoring.
              </p>
              <p>
                Production gate is enforced before deploy and should fail closed when required runtime dependencies are missing.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 font-mono text-xs text-neutral-200 space-y-1">
              <div>npm run harden:deploy -- .env.production</div>
              <div>npm run smoke:external:readiness</div>
              <div>npm run smoke:prod:runtime</div>
              <div>npm run gate:prod -- .env.production</div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">7. Current Implementation Surface</h2>
            <p className="text-sm text-neutral-300">
              Implemented runtime surface includes broadcast studio, watch playback, relay-based discovery, profiles/inbox/guild flows,
              moderation controls, analytics, wallet integrations, and deploy-time production gates.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/docs" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500 text-sm">
                Build Docs
              </Link>
              <Link
                href="/settings#wallet-integrations"
                className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500 text-sm"
              >
                Wallet Integrations
              </Link>
              <Link href="/donate" className="px-4 py-2 rounded-full bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-sm">
                Donate
              </Link>
            </div>
          </section>
        </article>
      </main>
    </div>
  );
}
