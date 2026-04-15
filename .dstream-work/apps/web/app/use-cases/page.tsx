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
    subtitle: "Censorship-Resistant Reality",
    detail:
      "Broadcast on the Nostr network where your identity and content cannot be deplatformed, silenced, or restricted by corporate policies."
  },
  {
    icon: Mic,
    label: "Creator Economy",
    borderHover: "hover:border-purple-500/40",
    chipClass: "bg-purple-900/30 text-purple-300",
    watermarkClass: "text-purple-500",
    title: "Performers and Creators",
    subtitle: "100% Payout Ownership",
    detail:
      "Keep everything you earn. Monetization is completely decentralized with direct crypto payments—no middlemen holding your funds or taking a cut."
  },
  {
    icon: Radio,
    label: "Live Ops",
    borderHover: "hover:border-emerald-500/40",
    chipClass: "bg-emerald-900/30 text-emerald-300",
    watermarkClass: "text-emerald-500",
    title: "Live Community Hosts",
    subtitle: "Viewer-Powered Fidelity",
    detail:
      "As your audience grows, your stream quality gets stronger! dStream uses P2P networks so viewers help scale and boost stream fidelity for everyone."
  },
  {
    icon: Coins,
    label: "Incentives",
    borderHover: "hover:border-amber-500/40",
    chipClass: "bg-amber-900/30 text-amber-300",
    watermarkClass: "text-amber-500",
    title: "Incentive-Driven Networks",
    subtitle: "Assist economics",
    detail:
      "Use host policy modes, rebroadcast queue thresholds, and stake-aware assist roles to align bandwidth contribution incentives."
  },
  {
    icon: Globe,
    label: "Self Hosting",
    borderHover: "hover:border-cyan-500/40",
    chipClass: "bg-cyan-900/30 text-cyan-300",
    watermarkClass: "text-cyan-500",
    title: "Self-Host Operators",
    subtitle: "Production-operable stack",
    detail:
      "Deploy with Docker, TURN, relay, wallet-rpc, backup/restore, and gate checks while preserving protocol-level portability."
  },
  {
    icon: Users,
    label: "Communities",
    borderHover: "hover:border-fuchsia-500/40",
    chipClass: "bg-fuchsia-900/30 text-fuchsia-300",
    watermarkClass: "text-fuchsia-500",
    title: "Curated Communities",
    subtitle: "Governance + moderation",
    detail:
      "Apply relay-backed moderation, role assignment, aliases, and inbox/profile workflows for long-lived decentralized communities."
  }
];

const implementationProfiles = [
  {
    title: "Creator Solo Stack",
    profile: "Single origin + relay + TURN",
    outcome: "Fast setup, direct monetization, portable identity."
  },
  {
    title: "Community Cluster",
    profile: "Shared relay set + multiple broadcasters",
    outcome: "Moderation delegation and long-lived guild/community continuity."
  },
  {
    title: "Self-Hosted Operator",
    profile: "Production compose + gate checks + backups",
    outcome: "Controlled runtime, predictable upgrades, and auditable deploy path."
  }
];

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-3 text-center">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Use Cases</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">Who dStream Benefits and How!</h1>
          <p className="text-neutral-300 max-w-3xl mx-auto">
            dStream is built for streamers and viewers who want a censorship-resistant network, scalable P2P video fidelity, and completely decentralized monetization without middlemen taking a cut.
          </p>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map(({ icon: Icon, title, subtitle, detail, label, borderHover, chipClass, watermarkClass }) => (
            <article key={title} className={`relative overflow-hidden rounded-2xl border border-neutral-800/60 bg-neutral-900/50 p-6 transition ${borderHover}`}>
              <div className="pointer-events-none absolute top-0 right-0 p-4 opacity-20">
                <Icon className={`w-24 h-24 ${watermarkClass}`} />
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${chipClass}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
              <h2 className="mt-4 text-xl font-bold">{title}</h2>
              <p className="mt-1 text-xs uppercase tracking-wider text-neutral-400">{subtitle}</p>
              <p className="mt-2 text-sm text-neutral-300 leading-relaxed">{detail}</p>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold text-center">Implementation Profiles</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-950/60 text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Profile</th>
                  <th className="text-left px-4 py-2 font-medium">Runtime Pattern</th>
                  <th className="text-left px-4 py-2 font-medium">Operational Outcome</th>
                </tr>
              </thead>
              <tbody>
                {implementationProfiles.map((row) => (
                  <tr key={row.title} className="border-t border-neutral-800 text-neutral-200 align-top">
                    <td className="px-4 py-2 font-semibold text-neutral-100">{row.title}</td>
                    <td className="px-4 py-2 text-neutral-300">{row.profile}</td>
                    <td className="px-4 py-2 text-neutral-300">{row.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold text-center">Next steps</h2>
          <p className="text-sm text-neutral-300 text-center">
            Read runtime docs, configure wallet integrations, then launch a broadcast with your payout rails configured.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/whitepaper" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">
              Whitepaper
            </Link>
            <Link href="/docs" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">
              Technical Docs
            </Link>
            <Link href="/settings#wallet-integrations" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">
              Wallet Integrations
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
