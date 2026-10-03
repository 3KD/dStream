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
    title: "Verify Payments",
    body: "Check rail status in Settings, execute a wallet payment, and verify its durable payment intent before granting paid access."
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
    details: "WebRTC data-channel assist can exchange requested HLS bytes when host policy and browser connectivity allow. The origin remains the bootstrap and fallback path."
  },
  {
    name: "Payments",
    details: "This deployment publicly accepts Monero, Bitcoin Lightning, and Bitcoin on-chain payments. Additional protocol adapters can remain backend-connected for real-chain operator checks without becoming public payment options."
  }
];

const eventKinds = [
  { kind: "30311", label: "Stream announce", note: "Replaceable live metadata (`d`, `title`, `streaming`, host mode, discoverability, payment methods)." },
  { kind: "1311", label: "Public stream chat", note: "Public text scoped by the stream `a` tag. Kind 1 is read only for compatibility." },
  { kind: "30312", label: "Presence", note: "Viewer heartbeat and participation estimates." },
  { kind: "8108", label: "P2P signaling", note: "WebRTC offers, answers, ICE candidates, and session control." },
  { kind: "30313", label: "Integrity manifest", note: "Signed rendition epochs and SHA-256 media-segment metadata." },
  { kind: "30317 / 30318", label: "Moderation / roles", note: "Stream-scoped actions and broadcaster-assigned roles." },
  { kind: "30315 / 30319 / 30320", label: "Guilds", note: "Guild metadata, membership, and owner-assigned roles." },
  { kind: "30321", label: "Discovery moderation", note: "Operator hide/restore actions for official app discovery surfaces only." },
  { kind: "10030", label: "Custom Emotes", note: "Broadcaster-specific emote mappings." },
  { kind: "1984", label: "Report", note: "Signed NIP-56-compatible abuse report." },
  { kind: "4", label: "DM / whisper", note: "NIP-04 encrypted private messages. The older kind 20004 draft is not used." }
];

const apiSurface = [
  { route: "/api/whip/:originStreamId/whip", role: "WHIP ingest proxy", auth: "Signed publisher path expected upstream." },
  { route: "/api/whep/:originStreamId/whep", role: "WHEP playback proxy", auth: "Public read; guarded by origin policy." },
  { route: "/api/hls/:originStreamId/*", role: "HLS passthrough", auth: "Public read with edge cache compatibility." },
  { route: "/api/xmr/tip/session(/:token)", role: "Verified tip lifecycle", auth: "Signed control requests." },
  { route: "/api/payments/catalog", role: "Asset + wallet integration metadata", auth: "Public read." },
  { route: "/api/payments/capabilities", role: "Configured verifier status", auth: "Public read; contains no provider credentials." },
  { route: "/api/payments/intents(/:intentId)", role: "Bound payment intent lifecycle", auth: "Signed buyer proof + one-time intent secret." },
  { route: "/api/payments/intents/:intentId/verify", role: "Rail receipt or transaction verification", auth: "Intent secret; provider configuration stays server-only." },
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
    reason: "The media origin has not produced the requested path, the broadcaster stopped, or the announcement points at an unavailable source.",
    action: "Retry once. If the path remains unavailable, the broadcaster or node operator must restore the media origin or correct the announcement."
  },
  {
    error: "WebRTC Assist Latency",
    reason: "The browser could not establish a peer data channel through the available ICE paths.",
    action: "Playback continues from the stream's HLS origin when it is available; peer assist is optional."
  },
  {
    error: "Announce Relay Drop",
    reason: "Media can remain active while one or more Nostr relays reject or miss the latest announcement.",
    action: "Check relay acceptance in Broadcast Studio and republish the announcement if no configured relay has the current event."
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
            <li>P2P assist can reduce repeated origin delivery but does not remove origin bootstrap/fallback requirements or increase encoded quality.</li>
            <li>Wallet integration never stores private keys; key material stays in user-controlled wallet software.</li>
            <li>A payment adapter is not active until its server-side verifier is configured and reports ready.</li>
            <li>Canonical routing is `(pubkeyHex, streamId)`; UI keeps npub-first addressing for users.</li>
            <li>Content responsibility is node-local: independent operators are responsible for what they broadcast/relay; dStream does not control third-party content.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
