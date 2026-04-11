import Link from "next/link";
import { BookOpen, ExternalLink, Shield, Wrench } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const quickStart = [
  {
    title: "Watch",
    body: "Open `/browse` or home cards, then watch from `/watch/:npub/:streamId` with WHEP-first and HLS fallback."
  },
  {
    title: "Connect Identity",
    body: "Use extension or local key in Settings. Canonical stream identity is `(pubkeyHex, streamId)`; UI routes are npub-first."
  },
  {
    title: "Go Live",
    body: "Open `/broadcast`, start preview, publish over WHIP, and confirm announce relay acceptance."
  },
  {
    title: "Verify Economics",
    body: "Run verified Monero tip/stake flow and confirm wallet-rpc session status from watch page."
  }
];

const runtimePlanes = [
  {
    name: "Identity + Coordination",
    details: "Nostr relays carry announce, moderation, presence, profile, and DM/whisper signaling."
  },
  {
    name: "Media Origin",
    details: "WHIP ingest to MediaMTX, remux to HLS, expose WHEP endpoints, maintain origin fallback."
  },
  {
    name: "Assist Transport",
    details: "WebRTC datachannel assist can offload HLS delivery when host policy and stake conditions allow."
  },
  {
    name: "Payments",
    details: "Monero wallet-rpc for verified flows; additional asset methods exposed as addresses + wallet URI hints."
  }
];

const protocolLandscape = [
  {
    title: "dStream",
    notes:
      "Nostr identity/discovery + WHIP/WHEP/HLS media stack + optional WebRTC assist queue (`host_only` vs `p2p_economy`) + Monero verified payment backend."
  },
  {
    title: "zap.stream",
    notes:
      "NIP-53-focused Nostr client with Lightning/Zap ecosystem alignment and a host/CDN-style media path centered around HLS/RTMP workflows."
  }
];

const eventKinds = [
  { kind: "30311", label: "Stream announce", note: "Replaceable live metadata (`d`, `title`, `streaming`, host mode, discoverability, payment methods)." },
  { kind: "30312", label: "Presence", note: "Viewer heartbeat and participation estimates." },
  { kind: "30313", label: "Moderation / roles", note: "Relay-scoped mute/block + moderator/subscriber role updates." },
  { kind: "30321", label: "Discovery moderation", note: "Operator hide/restore actions for official app discovery surfaces only." },
  { kind: "1", label: "Public chat", note: "Stream-associated public text events." },
  { kind: "4 / 20004", label: "DM / whisper", note: "Private encrypted channels for broadcaster/viewer coordination." }
];

const apiSurface = [
  { route: "/api/whip/:originStreamId/whip", role: "WHIP ingest proxy", auth: "Signed publisher path expected upstream." },
  { route: "/api/whep/:originStreamId/whep", role: "WHEP playback proxy", auth: "Public read; guarded by origin policy." },
  { route: "/api/hls/:originStreamId/*", role: "HLS passthrough", auth: "Public read with edge cache compatibility." },
  { route: "/api/xmr/tip/session(/:token)", role: "Verified tip lifecycle", auth: "Signed control requests." },
  { route: "/api/xmr/stake/session(/:token)", role: "Stake gate + refund lifecycle", auth: "Signed control requests." },
  { route: "/api/xmr/escrow/session/*", role: "Escrow-v3 multisig orchestration", auth: "Coordinator/participant scoped actions." },
  { route: "/api/payments/catalog", role: "Asset + wallet integration metadata", auth: "Public read." },
  { route: "/api/payments/validate", role: "Server-side payment method validator", auth: "Schema guard only." },
  { route: "/api/moderation/reports", role: "Abuse report intake + operator queue actions", auth: "Signed report/operator proof scopes." }
];

const productionGate = [
  "npm run harden:deploy -- .env.production",
  "npm run smoke:external:readiness",
  "npm run smoke:prod:runtime",
  "npm run gate:prod -- .env.production"
];

const troubleshooting = [
  {
    error: "HLS / WebRTC 404 Failure",
    reason: "The streamer's media pipeline has disconnected, or the P2P swarm cannot find their raw video track.",
    action: "Refresh the page. If the issue persists, the Creator has ended the live stream or their Node lost connection."
  },
  {
    error: "WebRTC Assist Latency",
    reason: "Viewer's browser is attempting to pull P2P segments from other viewers but is failing network ICE checks.",
    action: "System will automatically fallback to the central HLS node to preserve video playback."
  },
  {
    error: "Announce Relay Drop",
    reason: "The broadcaster's video feed is actively running, but their Chat Relay disconnected from Nostr.",
    action: "Broadcaster must trigger an 'Update Announce' on their control panel to physically reconnect their identity to the stream."
  }
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-4 text-center">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Technical Documentation</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">dStream Runtime Docs (Production Path)</h1>
          <p className="text-neutral-300 max-w-4xl mx-auto leading-relaxed">
            Updated reference for the current stack: Nostr identity, WHIP/WHEP/HLS media path, P2P assist policy controls, and wallet-integrated payment
            flows.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-5">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-neutral-500">
            <BookOpen className="w-4 h-4" />
            Getting Started
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {quickStart.map((step, index) => (
              <article key={step.title} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="text-xs font-mono text-neutral-500">Step {index + 1}</div>
                <h3 className="text-base font-semibold text-neutral-100 mt-1">{step.title}</h3>
                <p className="text-sm text-neutral-300 mt-2 leading-relaxed">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Runtime Architecture</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {runtimePlanes.map((plane) => (
              <article key={plane.name} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="text-sm font-semibold text-neutral-100">{plane.name}</div>
                <p className="text-sm text-neutral-300 mt-2 leading-relaxed">{plane.details}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Protocol Landscape</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {protocolLandscape.map((entry) => (
              <article key={entry.title} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="text-sm font-semibold text-neutral-100">{entry.title}</div>
                <p className="text-sm text-neutral-300 mt-2 leading-relaxed">{entry.notes}</p>
              </article>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            Detailed comparison notes are maintained in repository docs:
            <code className="ml-1">docs/COMPETITIVE_DELTA.md</code>
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Nostr Event Surface</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-950/60 text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Kind</th>
                  <th className="text-left px-4 py-2 font-medium">Purpose</th>
                  <th className="text-left px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {eventKinds.map((entry) => (
                  <tr key={entry.kind} className="border-t border-neutral-800 text-neutral-200 align-top">
                    <td className="px-4 py-2 font-mono">{entry.kind}</td>
                    <td className="px-4 py-2">{entry.label}</td>
                    <td className="px-4 py-2 text-neutral-300">{entry.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">HTTP/API Surface</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-950/60 text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Route</th>
                  <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-left px-4 py-2 font-medium">Auth / Guard</th>
                </tr>
              </thead>
              <tbody>
                {apiSurface.map((entry) => (
                  <tr key={entry.route} className="border-t border-neutral-800 text-neutral-200 align-top">
                    <td className="px-4 py-2 font-mono">{entry.route}</td>
                    <td className="px-4 py-2">{entry.role}</td>
                    <td className="px-4 py-2 text-neutral-300">{entry.auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Wallet Integration Workflow</h2>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>Configure payout methods in Broadcast (core fields + advanced payout section).</li>
            <li>Set preferred wallet per asset from Settings wallet integration panel.</li>
            <li>Watchers use copy/URI actions on watch page to pay with native app, extension, or CLI workflow.</li>
            <li>For XMR verification, viewers request a dedicated subaddress and check on-session status.</li>
          </ol>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/settings#wallet-integrations" className="px-4 py-2 rounded-full bg-neutral-900 border border-neutral-700 hover:border-neutral-500">
              Open Wallet Integrations
            </Link>
            <Link href="/broadcast" className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500">
              Configure Broadcast Payouts
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Safety &amp; Reporting</h2>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>In-app report controls are available on browse cards, watch header, and chat messages.</li>
            <li>Operators review report queue items in <strong>Moderation</strong> and can mark state transitions.</li>
            <li>Confirmed abuse can be hidden from official discovery surfaces without changing decentralized relay history.</li>
            <li>Policy URLs for app review: <code>/terms</code>, <code>/privacy</code>, <code>/community-guidelines</code>.</li>
          </ol>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/moderation" className="px-4 py-2 rounded-full bg-neutral-900 border border-neutral-700 hover:border-neutral-500">
              Open Moderation
            </Link>
            <Link href="/community-guidelines" className="px-4 py-2 rounded-full bg-neutral-900 border border-neutral-700 hover:border-neutral-500">
              Community Guidelines
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-200">
            <Wrench className="w-4 h-4" />
            Production Gate
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 font-mono text-xs text-neutral-200 space-y-1">
            {productionGate.map((command) => (
              <div key={command}>{command}</div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold">Known Failure Modes</h2>
          <div className="space-y-3">
            {troubleshooting.map((row) => (
              <article key={row.error} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-2">
                <div className="text-sm font-semibold text-neutral-100">{row.error}</div>
                <div className="text-sm text-neutral-300">
                  <span className="text-neutral-400">Cause:</span> {row.reason}
                </div>
                <div className="text-sm text-neutral-300">
                  <span className="text-neutral-400">Action:</span> {row.action}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
          <h2 className="text-2xl font-bold">Primary Reading</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/whitepaper" className="px-4 py-2 rounded-full bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30">
              Whitepaper
            </Link>
            <Link href="/creator-manual" className="px-4 py-2 rounded-full bg-purple-600/20 border border-purple-500/40 hover:bg-purple-600/30 font-bold">
              Creator Manual
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
              className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500 inline-flex items-center gap-2"
            >
              GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-200">
            <Shield className="w-4 h-4" />
            Trust Boundaries
          </div>
          <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-1.5">
            <li>P2P assist reduces host load but does not remove origin bootstrap/fallback requirements.</li>
            <li>Wallet integration never stores private keys; key material stays in user-controlled wallet software.</li>
            <li>Escrow-v3 is multisig workflow coordination, not a trustless smart-contract VM.</li>
            <li>Canonical routing is `(pubkeyHex, streamId)`; UI keeps npub-first addressing for users.</li>
            <li>Content responsibility is node-local: independent operators are responsible for what they broadcast/relay; dStream does not control third-party content.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
