import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const abuseContact = (process.env.NEXT_PUBLIC_ABUSE_CONTACT_EMAIL ?? "abuse@dstream.stream").trim();

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Legal</p>
          <h1 className="text-3xl font-black tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-neutral-400">Last updated: February 2026</p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">1) Identity and content transport</h2>
          <p>
            dStream uses public-key identity (Nostr). Stream announcements, public chat, and discovery moderation events are published to configured relays.
          </p>
          <p>
            This data may be replicated by third-party relays outside dstream.stream control.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">2) Local browser storage</h2>
          <p>
            Settings, aliases, favorites, and some session metadata are stored locally in your browser for UX continuity. You can export, restore, or reset
            this data in <Link href="/settings" className="text-blue-300 hover:text-blue-200">Settings</Link>.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">3) Report handling on official surfaces</h2>
          <p>
            When you submit abuse reports from official dstream.stream UI, operators store report metadata (target IDs, reason, optional note, timestamp, and
            optional reporter pubkey proof) for moderation workflow.
          </p>
          <p>
            Contact: <a className="text-blue-300 hover:text-blue-200" href={`mailto:${abuseContact}`}>{abuseContact}</a>
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-sm text-neutral-300">
          <h2 className="text-lg font-semibold text-neutral-100">4) Wallet and payment privacy</h2>
          <p>
            dStream is non-custodial. Keys stay in user wallets. The app can generate addresses/session references and read wallet status required for verified
            flows, but it does not hold funds.
          </p>
        </section>

        <section className="text-xs text-neutral-500">
          Related: <Link href="/terms" className="text-neutral-300 hover:text-white">Terms</Link> ·{" "}
          <Link href="/community-guidelines" className="text-neutral-300 hover:text-white">Community Guidelines</Link>
        </section>
      </main>
    </div>
  );
}

