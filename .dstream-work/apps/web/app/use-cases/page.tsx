import Link from "next/link";
import { Mic, Shield, Radio, Coins, Globe, Users } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const cases = [
  {
    icon: Shield,
    label: "Media Freedom",
    borderHover: "hover:border-blue-500/40",
    chipClass: "bg-blue-900/30 text-blue-300",
    watermarkClass: "text-blue-500",
    title: "Independent Journalists",
    detail: "Broadcast with portable identity and relay-based discovery that does not depend on one platform gatekeeper."
  },
  {
    icon: Mic,
    label: "Creator Economy",
    borderHover: "hover:border-purple-500/40",
    chipClass: "bg-purple-900/30 text-purple-300",
    watermarkClass: "text-purple-500",
    title: "Performers and Creators",
    detail: "Run direct audience monetization flows with private Monero tips and optional verified receipts."
  },
  {
    icon: Radio,
    label: "Live Ops",
    borderHover: "hover:border-emerald-500/40",
    chipClass: "bg-emerald-900/30 text-emerald-300",
    watermarkClass: "text-emerald-500",
    title: "Live Community Hosts",
    detail: "Maintain persistent stream identity (`npub + streamId`) across infrastructure and delivery changes."
  },
  {
    icon: Coins,
    label: "Incentives",
    borderHover: "hover:border-amber-500/40",
    chipClass: "bg-amber-900/30 text-amber-300",
    watermarkClass: "text-amber-500",
    title: "Incentive-Driven Networks",
    detail: "Use stake-gated assist and receipt-aware settlement paths to encourage contribution over leeching."
  },
  {
    icon: Globe,
    label: "Self Hosting",
    borderHover: "hover:border-cyan-500/40",
    chipClass: "bg-cyan-900/30 text-cyan-300",
    watermarkClass: "text-cyan-500",
    title: "Self-Host Operators",
    detail: "Deploy with Docker stack, configurable relays, and production hardening checks without central registry lock-in."
  },
  {
    icon: Users,
    label: "Communities",
    borderHover: "hover:border-fuchsia-500/40",
    chipClass: "bg-fuchsia-900/30 text-fuchsia-300",
    watermarkClass: "text-fuchsia-500",
    title: "Curated Communities",
    detail: "Use guild curation, moderation tooling, and inbox/profile surfaces for relay-native community operations."
  }
];

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-3 text-center">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Use Cases</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">Who this build is for</h1>
          <p className="text-neutral-300 max-w-3xl mx-auto">
            dStream is built for operators and creators who need transport flexibility, portable identity, and open discovery.
          </p>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map(({ icon: Icon, title, detail, label, borderHover, chipClass, watermarkClass }) => (
            <article key={title} className={`relative overflow-hidden rounded-2xl border border-neutral-800/60 bg-neutral-900/50 p-6 transition ${borderHover}`}>
              <div className="pointer-events-none absolute top-0 right-0 p-4 opacity-20">
                <Icon className={`w-24 h-24 ${watermarkClass}`} />
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${chipClass}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
              <h2 className="mt-4 text-xl font-bold">{title}</h2>
              <p className="mt-2 text-sm text-neutral-300 leading-relaxed">{detail}</p>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center space-y-4">
          <h2 className="text-2xl font-bold">Next steps</h2>
          <p className="text-sm text-neutral-300">Read the protocol description or jump straight into broadcasting.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/whitepaper" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">
              Whitepaper
            </Link>
            <Link href="/broadcast" className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700">
              Start Streaming
            </Link>
            <Link href="/donate" className="px-4 py-2 rounded-full bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30">
              Donate
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
