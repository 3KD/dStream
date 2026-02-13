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
              This document describes the architecture and trust boundaries of the currently shipped dStream rebuild.
            </p>
            <div className="text-xs text-neutral-500 flex flex-wrap gap-4">
              <span>Date: February 12, 2026</span>
              <span>Status: Live implementation reference</span>
              <span>Scope: v1 rebuild + shipped parity phases</span>
            </div>
          </header>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Abstract</h2>
            <p className="text-neutral-300 leading-relaxed">
              dStream is a decentralized live-streaming system where identity, discovery, and coordination are relay-driven (Nostr),
              while media transport is replaceable (WHIP ingest, WHEP/HLS playback, and optional peer assist). The design removes
              dependency on a central registry and keeps stream identity portable across infrastructure providers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">1. System Model</h2>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
              <p>
                <span className="text-neutral-100 font-semibold">Control plane (Nostr):</span> stream announce (`kind 30311`), presence,
                chat, direct messages, guild metadata, moderation signals, and P2P signaling.
              </p>
              <p>
                <span className="text-neutral-100 font-semibold">Media plane:</span> broadcaster publishes to origin via WHIP; watchers
                play via WHEP when possible, otherwise HLS through origin proxy.
              </p>
              <p>
                <span className="text-neutral-100 font-semibold">Assist plane:</span> viewers can exchange HLS fragments over WebRTC data
                channels; origin remains authoritative fallback.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">2. Canonical Identity and Routing</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Canonical stream key: `(pubkeyHex, streamId)`</li>
              <li>User-facing key format: `npub...` (NIP-19), with backend conversion to hex</li>
              <li>Watch route: `/watch/:npub/:streamId` (hex accepted for compatibility)</li>
              <li>Origin path derivation: `${"{pubkeyHex}"}--${"{streamId}"}`</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">3. Broadcast and Playback Flows</h2>
            <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
              <li>Broadcaster captures camera/screen, publishes to WHIP endpoint, and announces live state on relays.</li>
              <li>Watchers resolve stream metadata from relays and attempt WHEP playback first.</li>
              <li>On WHEP failure/unavailability, client falls back to HLS.</li>
              <li>P2P HLS assist can serve fragments between viewers while preserving origin fallback.</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">4. Integrity and Safety</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Integrity manifests are signed and verified in client when enabled.</li>
              <li>Tampered segment detection raises explicit integrity status.</li>
              <li>Moderation surfaces provide relay-backed stream actions and local mute/block enforcement.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">5. Monero and Incentives</h2>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Tip flows support Monero addresses and verified wallet-RPC-backed receipt checking.</li>
              <li>Stake gating can require confirmed stake before enabling assist participation.</li>
              <li>Escrow-v3 adds multisig coordination APIs for participant/coordinator workflows.</li>
            </ul>
            <p className="text-sm text-amber-300/90">
              Trust boundary note: escrow-v3 in this build is not a fully trustless on-chain contract system; settlement policy is
              still application/origin coordinated.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold">6. Current Implementation Surface</h2>
            <p className="text-sm text-neutral-300">
              The running rebuild includes: broadcast studio, watch playback, relay discovery, social settings, profiles, inbox DMs,
              guild curation, moderation tools, analytics, wallet capability probes, and automated smoke/hardening checks.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/docs" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500 text-sm">
                Build Docs
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
