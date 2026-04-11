import Link from "next/link";
import { BookOpen, ExternalLink, Shield, ShieldAlert, Key, Video, DollarSign, Signal } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

export default function CreatorManualPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-4 text-center border-b border-neutral-800 pb-8">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Mastering dStream</p>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">Creator Manual</h1>
          <p className="text-neutral-300 max-w-2xl mx-auto leading-relaxed">
            dStream is not a traditional platform. You are not broadcasting to a central server that artificially limits your reach or skims a percentage of your revenue. You are launching a decentralized node.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
              <Key className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">1. Establishing Independence: Your Nostr Identity</h2>
          </div>
          <p className="text-neutral-300 leading-relaxed">
            dStream relies on <strong>Nostr</strong> to route your Chat and authenticate your identity. You do not log in with a traditional email and password.
          </p>
          
          <div className="space-y-4 mt-4">
            <h3 className="text-lg font-semibold text-neutral-200">Creating your Keys</h3>
            <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
              <li>Navigate to your <strong>Settings</strong> icon.</li>
              <li>Select <strong>Generate Identity</strong>. This will produce a mathematical keypair.</li>
              <li className="text-amber-300 font-semibold">
                CRITICAL: Backup your Private Key. This is the only way to prove you own your account, your community reputation, and your channel handle. dStream does not have a "Forgot Password" button because the network is entirely decentralized.
              </li>
            </ol>
            
            <h3 className="text-lg font-semibold text-neutral-200 mt-6">Protecting Your Community</h3>
            <p className="text-sm text-neutral-300">
              Because there is no central corporation to ban bad actors, moderation is localized to your channel:
            </p>
            <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-2">
              <li>Click on a viewer's profile in Chat and click <strong>Mute</strong> to shield them from your view.</li>
              <li>Click <strong>Ban</strong> to mathematically discard their messages from the relay entirely so no other viewers see them.</li>
              <li>Use the <code>/w [Npub]</code> command in chat to securely decrypt and whisper private messages to moderators or trusted community members.</li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400">
              <Signal className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">2. Going Live: The Broadcast Studio</h2>
          </div>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2 mt-4">
            <li>Navigate to the <strong>Broadcast</strong> tab.</li>
            <li>You have native access to push <strong>WebRTC</strong> directly out from your browser using your Macbook/PC microphone and webcam inputs.</li>
            <li>Once active, the system automatically packages a secondary <strong>HLS (HTTP Live Streaming)</strong> index stream in the background. If a viewer connects on a poor cellular connection and cannot assist the P2P swarm via WebRTC, they will seamlessly fallback to your HLS origin track to ensure constant playback without buffering.</li>
          </ol>
          <div className="mt-4 p-4 rounded-xl border border-neutral-800 bg-neutral-950/50">
            <h4 className="text-sm font-semibold text-neutral-200 mb-2">OBS Integration</h4>
            <p className="text-xs text-neutral-400">
              Starting in OBS v30, they natively support <strong>WHIP</strong>. You can completely bypass the browser studio by pasting your stream's WHIP Proxy Endpoint into your OBS <em>Server</em> field, and streaming straight to the swarm.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-900/30 rounded-lg text-emerald-400">
              <Video className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">3. The Video Library: Uploads & Monetization</h2>
          </div>
          <p className="text-neutral-300 text-sm leading-relaxed">
            dStream acts as a full YouTube competitor. You do not have to just stream live; you can natively upload and distribute traditional Videos and packaged content.
          </p>

          <div className="space-y-4 mt-4">
            <h3 className="text-lg font-semibold text-neutral-200">Using the Operator Console</h3>
            <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
              <li>Navigate to <strong>Settings -&gt; Operator Console -&gt; Video Library</strong>.</li>
              <li>From the ingest tab, you can drag and drop raw MP4s onto your broadcast node.</li>
              <li>You can curate Playlists, tag your videos natively for the global index, and arrange the playback sequences.</li>
            </ol>

            <h3 className="text-lg font-semibold text-neutral-200 mt-6">Activating the Paywall (Private Pricing Gaps)</h3>
            <p className="text-sm text-neutral-300">You can directly monetize your raw uploads.</p>
            <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2">
              <li>In your <strong>Video Library</strong>, select a batch of files and mark them as <strong>Private / Published</strong>.</li>
              <li>The UI will instantly warn you of a <em>Private Pricing Gap</em>.</li>
              <li>Click the alert to automatically attach a <strong>Pricing Package</strong>. You can require viewers to cryptographically tip an exact amount of Monero (XMR) before the network hands them the decryption keys to unlock your video.</li>
            </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold">4. Unstoppable Economics: Monero Tipping</h2>
          </div>
          <p className="text-neutral-300 text-sm leading-relaxed mt-2">
            With dStream, there is no banking middle-man tracking your community's generosity.
          </p>
          <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-2 mt-4">
            <li>Ensure your node's <code>xmr-wallet-rpc</code> is securely firing on your droplet, and your wallet address is bound in Settings.</li>
            <li>Viewers who click the orange <strong>Drop Tip</strong> button in your live chat will pop open a Monero QR Code modal.</li>
            <li>The server securely maps an ephemeral Subaddress physically to your active stream.</li>
            <li>When a user scans the QR code and submits the drop, the network will ping the daemon. Once the mempool detects 0-confirmations, the UI shifts to <em>Pending</em>.</li>
            <li>Complete verification explodes into a visual pop-up inside your chat for the entire audience to see. 100% of the value routes directly to your cold storage layer without a single central fee.</li>
          </ol>
        </section>

        <div className="flex justify-center pt-8 border-t border-neutral-800">
          <p className="text-lg font-mono text-neutral-400">Welcome to Uncensorable Media.</p>
        </div>

      </main>
    </div>
  );
}
