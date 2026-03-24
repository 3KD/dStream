import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const abuseContact = (process.env.NEXT_PUBLIC_ABUSE_CONTACT_EMAIL ?? "abuse@dstream.stream").trim();

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Legal</p>
          <h1 className="text-3xl font-black tracking-tight">Terms of Service</h1>
          <p className="text-sm text-neutral-400">Last updated: February 2026</p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">1) Independent node responsibility</h2>
          <p>
            dStream is decentralized software. Each node operator, broadcaster, and relay participant is responsible for the content they publish, relay, or
            index. dStream does not pre-screen decentralized network traffic.
          </p>
          <p>
            The official surfaces for <span className="font-mono">dstream.stream</span> can hide content from app discovery and search, but this does not delete
            content from third-party relays or independent nodes.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">2) Acceptable use</h2>
          <p>You agree not to use official dstream.stream surfaces for illegal content, fraud, harassment, impersonation, or distribution of malware.</p>
          <p>
            See <Link href="/community-guidelines" className="text-blue-300 hover:text-blue-200">Community Guidelines</Link> for policy details and enforcement
            expectations.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">3) Payments and wallets</h2>
          <p>
            dStream is non-custodial. Wallet keys remain under user control. dStream does not hold user funds and does not reverse on-chain transfers.
          </p>
          <p>
            Streamers configure payout methods. Viewers are responsible for verifying destination addresses before sending.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">4) Enforcement on official surfaces</h2>
          <p>
            Operators may hide streams or creators from official discovery surfaces based on abuse reports and policy review. Operators can also dismiss reports.
          </p>
          <p>
            Abuse contact: <a className="text-blue-300 hover:text-blue-200" href={`mailto:${abuseContact}`}>{abuseContact}</a>
          </p>
        </section>

        <section id="privacy" className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300 scroll-mt-28">
          <h2 className="text-lg font-semibold text-neutral-100">5) Privacy and data handling</h2>
          <p>
            Identity, stream announce metadata, and public chat are relay-native and may be replicated by third-party relays outside operator control.
          </p>
          <p>
            Official app surfaces store local browser data for continuity (settings, aliases, favorites, and session metadata). Users can export, restore, or
            reset this data from <Link href="/settings" className="text-blue-300 hover:text-blue-200">Settings</Link>.
          </p>
          <p>
            Abuse reports submitted through official surfaces may include target identifiers, reason, optional note, timestamps, and optional reporter pubkey
            proof for moderation workflow and audit.
          </p>
          <p>
            dStream does not custody wallet keys. Payment flows may generate session references or addresses, but key material remains with user-controlled wallet
            software.
          </p>
        </section>

        <section className="text-xs text-neutral-500">
          Related: <Link href="/community-guidelines" className="text-neutral-300 hover:text-white">Community Guidelines</Link> ·{" "}
          <Link href="/support" className="text-neutral-300 hover:text-white">Support</Link>
        </section>
      </main>
    </div>
  );
}
