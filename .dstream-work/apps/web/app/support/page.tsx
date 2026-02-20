import { Bug, ExternalLink, Lightbulb, MessageCircle, ShieldAlert } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { getSupportLinks } from "@/lib/support";

const supportLinks = getSupportLinks();

const supportCards = [
  {
    title: "Report a Bug",
    description: "Open a prefilled GitHub issue for reproducible defects.",
    href: supportLinks.bugIssue,
    icon: Bug,
    cta: "Create bug issue"
  },
  {
    title: "Request a Feature",
    description: "Open a feature proposal issue with problem/solution details.",
    href: supportLinks.featureIssue,
    icon: Lightbulb,
    cta: "Create feature request"
  },
  {
    title: "Ask for Help",
    description: "Use GitHub Discussions for setup, usage, and troubleshooting.",
    href: supportLinks.discussion,
    icon: MessageCircle,
    cta: "Open discussion"
  },
  {
    title: "Report Security Issue",
    description: "Use GitHub private security advisories (avoid posting security details in public issues).",
    href: supportLinks.securityAdvisory,
    icon: ShieldAlert,
    cta: "Open private advisory"
  }
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Support Hub</h1>
          <p className="text-neutral-300 max-w-3xl">
            dStream support is GitHub-first. This keeps requests organized, searchable, and public by default.
          </p>
        </header>

        <section className="grid gap-4 sm:gap-5 md:grid-cols-2">
          {supportCards.map((card) => {
            const Icon = card.icon;
            return (
              <a
                key={card.title}
                href={card.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-800/90 bg-neutral-900/60 p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-400/45 hover:shadow-[0_14px_34px_rgba(0,0,0,0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-blue-500/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg font-semibold leading-tight text-neutral-100">{card.title}</h2>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-neutral-500 transition-colors group-hover:text-blue-300" />
                </div>

                <p className="relative mt-4 text-sm leading-relaxed text-neutral-300">{card.description}</p>

                <div className="relative mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/15 px-4 py-3 text-sm font-semibold text-blue-100 transition-colors group-hover:border-blue-400/55 group-hover:bg-blue-500/20">
                  {card.cta}
                  <ExternalLink className="h-4 w-4" />
                </div>
              </a>
            );
          })}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 sm:p-6 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">Support Process</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Search existing issues/discussions first.</li>
            <li>Open bug or feature issue with clear reproduction details.</li>
            <li>Attach browser/device info and logs for media/network problems.</li>
            <li>Use private advisory channel for security-sensitive findings.</li>
          </ol>
          <div className="pt-1 text-xs sm:text-sm text-neutral-500">
            Repository:{" "}
            <a
              href={supportLinks.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-300 hover:text-white break-all"
            >
              {supportLinks.repoUrl}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
