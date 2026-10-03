import Link from "next/link";
import { Key, Network, Video, WalletCards } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

export default function CreatorManualPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-4 text-center border-b border-neutral-800 pb-8">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Creator Reference</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">Creator Manual</h1>
          <p className="text-neutral-300 max-w-2xl mx-auto leading-relaxed">
            Set up your identity, connect an encoder, publish a discoverable stream, and receive payments without giving dStream custody of your keys or funds.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
              <Key className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">1. Connect Your Nostr Identity</h2>
          </div>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>Open <strong>Settings</strong> and connect a NIP-07 extension, import an existing key, or generate a local identity.</li>
            <li>Back up the private key in a secure location. dStream cannot reset or recover it.</li>
            <li>Never paste a private key or wallet seed into chat, a support form, a public environment variable, or a stream setting.</li>
            <li>Complete your display name, image, and bio, then publish the profile to your configured Nostr relays.</li>
          </ol>
          <p className="text-sm text-neutral-400">
            Your key is portable across compatible Nostr clients and relays. Individual relays can still reject or remove events, so configure more than one relay.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400">
              <Video className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">2. Go Live</h2>
          </div>
          <h3 className="text-lg font-semibold text-neutral-200">Browser Studio</h3>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>Open <strong>Broadcast</strong>, choose the browser source, and allow the camera, microphone, or screen permissions you need.</li>
            <li>Confirm the preview, title, visibility, topics, chat policy, and payout methods.</li>
            <li>Start the broadcast and wait for Media Signal and Announce status to confirm before sharing the watch link.</li>
            <li>Use End Stream when finished so the latest kind 30311 announcement is published with <code>status=ended</code>.</li>
          </ol>
          <h3 className="text-lg font-semibold text-neutral-200">OBS or Another Encoder</h3>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>Select the OBS / Encoder mode in Broadcast Studio.</li>
            <li>Copy the displayed server and stream key into a Custom RTMP service in OBS. Compatible clients may use the displayed WHIP endpoint instead.</li>
            <li>Start the encoder and wait for dStream to detect the media signal.</li>
            <li>Keep Broadcast Studio open long enough to publish and refresh the public live announcement.</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-900/30 rounded-lg text-emerald-400">
              <Network className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">3. Discovery and Delivery</h2>
          </div>
          <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
            <li>Public discovery comes from signed kind 30311 announcements on the configured Nostr relays.</li>
            <li>The direct watch route is identified by your public key and stream ID, not by a central account record.</li>
            <li>The media origin ingests and seeds every live stream. WHEP is used where viable and HLS provides compatibility and recovery.</li>
            <li>Optional viewer assist can exchange requested HLS bytes over WebRTC. It can reduce origin load, but it does not increase the resolution or bitrate sent by your encoder.</li>
            <li>If a direct watch link works but Browse does not, inspect relay acceptance and republish the current announcement before changing the media pipeline.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
              <WalletCards className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">4. Receive Payments</h2>
          </div>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
            <li>Add creator-controlled payout destinations in <strong>Settings - Wallet Integrations</strong>.</li>
            <li>Apply the payment methods you want to advertise from Broadcast Studio. Do not advertise an address you have not verified in its wallet.</li>
            <li>dstream.stream currently exposes Monero, Bitcoin Lightning, and Bitcoin on-chain as verified public rails.</li>
            <li>Viewers open a wallet action from the watch page. dStream does not hold the viewer&apos;s or creator&apos;s private keys.</li>
            <li>Node operators, not ordinary creators, configure wallet RPC, chain RPC, indexer, and provider credentials on the server.</li>
          </ol>
          <p className="text-sm text-neutral-400">
            Privacy depends on the rail. Monero is private by default; Bitcoin and most other public ledgers expose transaction data.
          </p>
        </section>

        <section className="border-t border-neutral-800 pt-8">
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <Link href="/broadcast" className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500">Open Broadcast Studio</Link>
            <Link href="/settings#wallet-integrations" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">Wallet Integrations</Link>
            <Link href="/docs" className="px-4 py-2 rounded-full bg-neutral-800 border border-neutral-700 hover:border-neutral-500">Technical Docs</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
