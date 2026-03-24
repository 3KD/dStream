import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const abuseContact = (process.env.NEXT_PUBLIC_ABUSE_CONTACT_EMAIL ?? "abuse@dstream.stream").trim();

const prohibited = [
  "Illegal content and credible threats of violence",
  "Child sexual abuse material or exploitation",
  "Fraud, scams, phishing, and financial impersonation",
  "Targeted harassment, hate speech, or doxxing",
  "Malware distribution or exploit payload delivery",
  "Copyright infringement where rights-holder notice is received"
];

export default function CommunityGuidelinesPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Safety</p>
          <h1 className="text-3xl font-black tracking-tight">Community Guidelines</h1>
          <p className="text-sm text-neutral-400">Last updated: February 2026</p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">Scope</h2>
          <p>
            These rules apply to official dstream.stream discovery surfaces and app distribution channels. Independent nodes and relays still control their own
            moderation.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">Prohibited on official surfaces</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            {prohibited.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">Report and enforcement flow</h2>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Users can report streams, users, and chat messages from in-app controls.</li>
            <li>Operators review reports in the Moderation inbox.</li>
            <li>Operators can mark reports as reviewing/resolved/dismissed.</li>
            <li>For confirmed abuse, operators can hide creators/streams from official discovery.</li>
          </ol>
          <p>
            Abuse contact: <a className="text-blue-300 hover:text-blue-200" href={`mailto:${abuseContact}`}>{abuseContact}</a>
          </p>
        </section>

        <section className="text-xs text-neutral-500">
          Related: <Link href="/terms" className="text-neutral-300 hover:text-white">Terms</Link> ·{" "}
          <Link href="/moderation" className="text-neutral-300 hover:text-white">Moderation</Link> ·{" "}
          <Link href="/support" className="text-neutral-300 hover:text-white">Support</Link>
        </section>
      </main>
    </div>
  );
}
