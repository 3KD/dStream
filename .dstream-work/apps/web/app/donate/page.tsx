import Link from "next/link";
import { Copy, Heart, Wallet } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

const supportXmrAddress = (process.env.NEXT_PUBLIC_SUPPORT_XMR_ADDRESS ?? "").trim();

export default function DonatePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Support</p>
          <h1 className="text-4xl font-black tracking-tight inline-flex items-center gap-3">
            <Heart className="w-9 h-9 text-rose-400" />
            Donate to dStream
          </h1>
          <p className="text-neutral-300 max-w-3xl">
            dStream is designed to be self-hostable and decentralized. Support keeps protocol work, testing, and infrastructure moving.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <h2 className="text-2xl font-bold inline-flex items-center gap-2">
            <Wallet className="w-6 h-6 text-orange-400" />
            Monero Support Address
          </h2>

          {supportXmrAddress ? (
            <>
              <p className="text-sm text-neutral-400">Send XMR directly to:</p>
              <p className="font-mono text-sm md:text-base break-all text-neutral-200">{supportXmrAddress}</p>
              <p className="text-xs text-neutral-500 inline-flex items-center gap-2">
                <Copy className="w-4 h-4" />
                Copy from your wallet client to avoid transcription errors.
              </p>
            </>
          ) : (
            <div className="text-sm text-neutral-300 space-y-2">
              <p>This deployment does not currently expose a platform donation address.</p>
              <p className="text-neutral-500">
                To enable one, set <span className="font-mono text-neutral-300">NEXT_PUBLIC_SUPPORT_XMR_ADDRESS</span> and redeploy.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-3 text-sm text-neutral-300">
          <h2 className="text-2xl font-bold">Other Ways to Help</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Tip streamers directly from watch pages (Monero panel).</li>
            <li>Run smoke suites and report regressions with logs.</li>
            <li>Host your own relays/origin nodes and contribute hardening feedback.</li>
          </ul>
          <div className="pt-2">
            <Link href="/docs" className="text-blue-400 hover:text-blue-300">
              Read deployment and architecture docs →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
