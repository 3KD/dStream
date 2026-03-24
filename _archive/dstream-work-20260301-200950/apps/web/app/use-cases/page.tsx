import Link from "next/link";
import { Mic, Shield, Radio, Coins, Globe, Users } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const cases = [
  {
    icon: Shield,
    title: "Independent Journalists",
    detail: "Broadcast with portable identity and relay-based discovery that does not depend on one platform gatekeeper."
  },
  {
    icon: Mic,
    title: "Performers and Creators",
    detail: "Run direct audience monetization flows with private Monero tips and optional verified receipts."
  },
  {
    icon: Radio,
    title: "Live Community Hosts",
    detail: "Maintain persistent stream identity (`npub + streamId`) across infrastructure and delivery changes."
  },
  {
    icon: Coins,
    title: "Incentive-Driven Networks",
    detail: "Use stake-gated assist and receipt-aware settlement paths to encourage contribution over leeching."
  },
  {
    icon: Globe,
    title: "Self-Host Operators",
    detail: "Deploy with Docker stack, configurable relays, and production hardening checks without central registry lock-in."
  },
  {
    icon: Users,
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

        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {cases.map(({ icon: Icon, title, detail }) => (
            <article key={title} className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3">
              <Icon className="w-7 h-7 text-blue-400" />
              <h2 className="text-xl font-bold">{title}</h2>
              <p className="text-sm text-neutral-300 leading-relaxed">{detail}</p>
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
              Go Live
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
