"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { useState } from "react";
import { PlatformDonationModal } from "@/components/tipping/PlatformDonationModal";

export default function WhitepaperPage() {
    const [showDonationModal, setShowDonationModal] = useState(false);
    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <PlatformDonationModal isOpen={showDonationModal} onClose={() => setShowDonationModal(false)} />
            {/* Header */}
            <header className="border-b border-neutral-800 p-6 sticky top-0 bg-neutral-950/80 backdrop-blur-md z-50">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition">
                        <ArrowLeft className="w-5 h-5" />
                        Back to App
                    </Link>
                    <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-500" />
                        <span className="font-bold">dStream Whitepaper</span>
                        <span className="text-xs bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded ml-2">v1.0.0</span>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto p-6 md:py-12">
                <article className="prose prose-invert prose-lg max-w-3xl mx-auto prose-headings:text-white prose-headings:text-center prose-headings:font-bold prose-headings:tracking-tight prose-a:text-blue-400 hover:prose-a:text-blue-300 prose-code:text-yellow-300 prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800 prose-li:marker:text-neutral-500">

                    <h1 className="text-5xl mb-8">dStream Protocol Whitepaper</h1>

                    <div className="flex flex-wrap justify-center gap-6 text-sm text-neutral-400 border-b border-neutral-800 pb-12 mb-12">
                        <span><strong>Date:</strong> Dec 31, 2025</span>
                        <span className="text-neutral-700">•</span>
                        <span><strong>License:</strong> MIT / Public Domain</span>
                        <span className="text-neutral-700">•</span>
                        <span><strong>Status:</strong> Draft</span>
                    </div>

                    <h2 className="text-3xl mt-16 mb-8">Abstract</h2>

                    <p className="text-neutral-300 mb-6">
                        dStream is a decentralized, ownerless, and permissionless live broadcasting protocol. It is specifically designed to resist censorship and eliminate platform de-risking, while fostering financial independence for creators.
                    </p>

                    <p className="text-neutral-300 mb-6">
                        By combining Nostr for immutable identity and signaling, WebTorrent for peer-to-peer distribution, and Monero for private cryptoeconomics, dStream creates a self-sustaining ecosystem where no central authority controls the network.
                    </p>

                    <p className="text-neutral-300 mb-6">
                        This paper outlines the protocol's architecture, cryptographic primitives, and economic incentives required to reproduce or fork the network, ensuring free speech is preserved by code rather than policy.
                    </p>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-16 mb-8">1. Introduction</h2>

                    <p>
                        Traditional broadcasting platforms (Twitch, YouTube) rely on centralized ingest and distribution servers. This architecture creates a single point of failure and control.
                    </p>

                    <p>
                        It enables:
                    </p>
                    <ul className="space-y-2">
                        <li><strong>Censorship:</strong> Arbitrary banning of creators.</li>
                        <li><strong>De-platforming:</strong> Removal of entire categories of content.</li>
                        <li><strong>Rent extraction:</strong> High fees (30-50%) on user revenue.</li>
                    </ul>

                    <p className="mt-8">
                        dStream inverts this model.
                    </p>

                    <p>
                        The "platform" is a set of open protocols. The "server" is a swarm of viewing peers. The "bank" is a private, decentralized ledger.
                    </p>

                    <h2 className="text-3xl mt-20 mb-12">2. System architecture</h2>

                    <div className="my-12">
                        <p className="text-xl text-neutral-300 mb-8">
                            The protocol is composed of three distinct layers:
                        </p>
                        <ul className="space-y-8">
                            <li className="pl-4 border-l-2 border-purple-500/50">
                                <strong className="text-white block text-lg mb-2">1. Identity (Nostr)</strong>
                                <span className="text-neutral-400">Global registry of users and streams. Uses Schnorr signatures for immutable ownership.</span>
                            </li>
                            <li className="pl-4 border-l-2 border-blue-500/50">
                                <strong className="text-white block text-lg mb-2">2. Ingest (Edge)</strong>
                                <span className="text-neutral-400">Transcodes RTMP to HLS. Acts as the initial seeder for the swarm.</span>
                            </li>
                            <li className="pl-4 border-l-2 border-green-500/50">
                                <strong className="text-white block text-lg mb-2">3. Distribution (P2P)</strong>
                                <span className="text-neutral-400">WebTorrent swarm scales bandwidth linearly with viewership.</span>
                            </li>
                        </ul>
                    </div>

                    <h3 className="text-2xl mt-12 mb-6">2.1 Identity & signaling layer (Nostr)</h3>
                    <ul className="space-y-3">
                        <li><strong>Role:</strong> Global, immutable registry of users and streams.</li>
                        <li><strong>Technology:</strong> Nostr (Notes and Other Stuff Transmitted by Relays).</li>
                        <li><strong>Function:</strong>
                            <ul className="mt-2 space-y-2">
                                <li><strong>Identity:</strong> Public keys (<code>npub</code>) serve as channel IDs.</li>
                                <li><strong>Discovery:</strong> Broadcasters publish "stream events" (Kind <code>30311</code>) to relays.</li>
                                <li><strong>Signaling:</strong> Viewers query relays to find active streams and connection details.</li>
                            </ul>
                        </li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">2.2 Ingestion & transcoding layer (edge nodes)</h3>
                    <ul className="space-y-3">
                        <li><strong>Role:</strong> Convert high-bitrate RTMP input into P2P-friendly HLS segments.</li>
                        <li><strong>Technology:</strong> <code>MediaMTX</code> (or compatible RTMP server) + <code>ffmpeg</code>.</li>
                        <li><strong>Function:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>Accepts RTMP stream from broadcaster (OBS).</li>
                                <li>Transcodes to HLS (<code>.m3u8</code> playlist + <code>.ts</code> segments).</li>
                                <li>Serves initial segments to the first peers in the swarm.</li>
                            </ul>
                        </li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">2.3 Distribution layer (WebTorrent P2P)</h3>
                    <ul className="space-y-3">
                        <li><strong>Role:</strong> Scale bandwidth linearly with viewership.</li>
                        <li><strong>Technology:</strong> WebRTC datachannels + BitTorrent protocol.</li>
                        <li><strong>Function:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>Viewers download segments from the ingest node.</li>
                                <li>Viewers re-seed segments to other viewers.</li>
                                <li><strong>Result:</strong> Bandwidth cost <code>C(n)</code> approximates <code>O(1)</code> for the host, rather than <code>O(n)</code>.</li>
                            </ul>
                        </li>
                    </ul>

                    <h2 className="text-3xl mt-20 mb-12">3. Core workflows (how it works)</h2>
                    <p>This section details the specific technical flows that stitch the architecture together.</p>

                    <h3 className="text-2xl mt-12 mb-6">3.1 Broadcasting flow (the publisher)</h3>
                    <p>
                        dStream uses <strong>WebRTC (WHIP)</strong> for ultra-low latency ingress, authenticated via cryptographic signatures rather than passwords.
                    </p>
                    <ol className="space-y-4">
                        <li><strong>Signaling:</strong> The broadcaster software (OBS or Browser) generates a <code>publish</code> offer.</li>
                        <li><strong>Authentication:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>The broadcaster signs a payload containing the <code>stream_path</code> and <code>timestamp</code> using their <strong>Ed25519 private key</strong>.</li>
                                <li>The signature is sent as a query parameter: <code>?pubkey=&lt;hex&gt;&sig=&lt;hex&gt;&t=&lt;timestamp&gt;</code>.</li>
                            </ul>
                        </li>
                        <li><strong>Verification:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>MediaMTX delegates auth to the <strong>auth server</strong> (<code>api/auth/publish</code>).</li>
                                <li>The server verifies:
                                    <ol className="mt-2 space-y-2 list-[lower-alpha]">
                                        <li><strong>Timestamp:</strong> Prevents replay attacks (must be within 5-minute window).</li>
                                        <li><strong>Binding:</strong> Ensures <code>Hash(StreamName + PubKey) === StreamPath</code>.</li>
                                        <li><strong>Signature:</strong> Validates that the owner of <code>PubKey</code> authorized this session.</li>
                                    </ol>
                                </li>
                            </ul>
                        </li>
                        <li><strong>Ingest:</strong> Upon success, the stream is accepted and transcoded to HLS for distribution.</li>
                    </ol>

                    <h3 className="text-2xl mt-12 mb-6">3.2 Playback flow (the viewer)</h3>
                    <p>
                        Viewers consume content via a hybrid P2P/CDN model to maximize resilience and minimize cost.
                    </p>
                    <ol className="space-y-4">
                        <li><strong>Discovery:</strong> The client queries a Nostr relay for Kind <code>30311</code> events to find live streams.</li>
                        <li><strong>Connection:</strong> The client connects to the <code>hls_url</code> specified in the event tags.</li>
                        <li><strong>P2P Swarm:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>The player attempts to peer with other viewers on the same stream/segment.</li>
                                <li><strong>Tier 1:</strong> Pulls data from nearby peers (WebRTC datachannels).</li>
                                <li><strong>Tier 2:</strong> Falls back to the ingest node (edge server) if no peers are available.</li>
                            </ul>
                        </li>
                        <li><strong>Latency:</strong> Users choose between low-latency HLS (3-5s delay, stable) or WebRTC playback (sub-second, higher resource usage).</li>
                    </ol>

                    <h3 className="text-2xl mt-12 mb-6">3.3 Communication layer (whispers)</h3>
                    <p>
                        Communication is strictly separated into Public Chat (Ephemeral/Global) and Private Whispers (Encrypted).
                    </p>
                    <ul className="space-y-4">
                        <li><strong>Public Chat:</strong> Standard Nostr Kind <code>1</code> text notes. Unencrypted, relayed globally.</li>
                        <li><strong>Whispers (private messaging):</strong>
                            <ul className="mt-2 space-y-2">
                                <li><strong>Encryption:</strong> Uses <strong>NIP-04</strong> (Diffie-Hellman key exchange) for strong privacy.</li>
                                <li><strong>Envelope System:</strong> To whisper to multiple people (e.g., a viewer + the broadcaster) simultaneously, the client creates a custom JSON envelope.</li>
                                <li><strong>Routing:</strong> The message is encrypted <em>separately</em> for each recipient and wrapped in a Kind <code>20004</code> ephemeral event.</li>
                                <li><strong>Visibility:</strong> Only the sender, the designated recipients, and the broadcaster (for moderation) possess the private keys to decrypt the specific payload intended for them.</li>
                            </ul>
                        </li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">3.4 Value layer (Monero tipping)</h3>
                    <p>
                        dStream operates on a "Donation, Not Subscription" model by default, using Monero for privacy.
                    </p>
                    <ol className="space-y-4">
                        <li><strong>Invoice request:</strong> Viewer clicks "Tip". Client derives a deterministic <strong>subaddress</strong> index for this specific transaction.</li>
                        <li><strong>Transfer:</strong> Viewer sends XMR to the generated subaddress.</li>
                        <li><strong>Verification:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>The broadcaster's wallet (view-only) constantly scans the blockchain.</li>
                                <li>When a transaction to the derived subaddress is confirmed (or enters mempool), the UI triggers a "tip alert".</li>
                                <li><strong>Zero-knowledge:</strong> The specific amount and sender identity remain obfuscated on-chain; only the broadcaster and tipper know the details.</li>
                            </ul>
                        </li>
                    </ol>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-20 mb-12">4. Protocol specification</h2>
                    <p className="mb-8 text-neutral-400">
                        dStream uses standard Nostr event structures.
                        <strong>Note:</strong> All `content` fields containing structural data MUST be stringified JSON.
                    </p>

                    {/* Kind 0 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 0: Metadata (Identity)</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Content:</strong> Stringified JSON object.
                        Used by clients to resolve <code>pubkey</code> to human-readable names.
                    </p>
                    <pre><code>{`{
  "kind": 0,
  "pubkey": "<user_pubkey>",
  "created_at": 1700000000,
  "tags": [],
  "content": "{\\"name\\":\\"alice\\",\\"about\\":\\"...\\",\\"picture\\":\\"https://...\\"}"
}`}</code></pre>

                    {/* Kind 30311 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 30311: Stream Announcement</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Tags:</strong> Used for indexing and filtering.
                        <strong>Content:</strong> Human-readable description (Markdown allowed).
                    </p>
                    <pre><code>{`{
  "kind": 30311,
  "content": "## Stream Agenda\\n1. Tech Talk\\n2. Q&A",
  "tags": [
    ["d", "stream"],                  // Identifier (Replaceable)
    ["status", "live"],               // Index: "live" | "ended"
    ["streaming", "https://...m3u8"], // Index: HLS URL
    ["image", "https://...jpg"],      // Index: Thumbnail
    ["title", "Stream Title"],
    ["t", "tech"],                    // Index: Hashtag
    ["p", "<host_pubkey>"]
  ]
}`}</code></pre>

                    {/* Kind 1 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 1: Public Chat</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Tags:</strong> <code>a</code> tag binds message to the stream event. <code>root</code> marker essential for threading.
                    </p>
                    <pre><code>{`{
  "kind": 1,
  "content": "Hello Stream!",
  "tags": [
    ["a", "30311:<host_pubkey>:stream", "root"], // Binds to Stream
    ["p", "<host_pubkey>"]                        // Monitor/Notify Host
  ]
}`}</code></pre>

                    {/* Kind 20004 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 20004: Ephemeral Whisper</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Content:</strong> Stringified JSON envelope.
                        Contains map of <code>pubkey &rarr; ciphertext</code>.
                        Each ciphertext is encrypted via NIP-04 (Sender PrivKey + Recipient PubKey).
                    </p>
                    <pre><code>{`{
  "kind": 20004,
  "tags": [
    ["a", "30311:<host_pubkey>:stream"], // Context
    ["p", "<host_pubkey>"],               // Index: Recipient
    ["p", "<mod_pubkey>"]                 // Index: Recipient
  ],
  "content": "{\\"recipients\\":{\\"<host_pubkey>\\":\\"<nip04_blob_1>\\",\\"<mod_pubkey>\\":\\"<nip04_blob_2>\\"}}"
}`}</code></pre>

                    {/* Kind 4 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 4: Direct Message</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Content:</strong> NIP-04 Encrypted String (Base64).
                        Decryptable only by the tagged <code>p</code> recipient and the sender.
                    </p>
                    <pre><code>{`{
  "kind": 4,
  "tags": [["p", "<recipient_pubkey>"]],
  "content": "<nip04_ciphertext_base64>"
}`}</code></pre>

                    {/* Kind 10000 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 10000: Mute List</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Tags:</strong> Public list of 'muted' pubkeys.
                        Used by broadcaster clients to automatically filter chat.
                    </p>
                    <pre><code>{`{
  "kind": 10000,
  "content": "", 
  "tags": [
    ["p", "<banned_pubkey>", "spam"],
    ["p", "<banned_pubkey_2>", "abuse"]
  ]
}`}</code></pre>

                    {/* Kind 1984 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 1984: Reporting</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Tags:</strong> <code>e</code> tag links to the specific offending event (e.g., a chat message).
                    </p>
                    <pre><code>{`{
  "kind": 1984,
  "content": " abusive content",
  "tags": [
    ["p", "<reported_pubkey>", "offensive"],
    ["e", "<evidence_event_id>"]
  ]
}`}</code></pre>

                    {/* Kind 9735 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 9735: Zap Receipt</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Tags:</strong> <code>bolt11</code> contains the payment hash. <code>description</code> contains the zapped request.
                    </p>
                    <pre><code>{`{
  "kind": 9735,
  "content": "",
  "tags": [
    ["p", "<recipient>"],
    ["P", "<sender>"],
    ["bolt11", "<lnbc...>"],
    ["description", "<json_string_of_zap_request>"]
  ]
}`}</code></pre>

                    {/* Kind 24242 */}
                    <h3 className="text-2xl mt-12 mb-4 font-mono">Kind 24242: Stream Access Token</h3>
                    <p className="mb-4 text-sm text-neutral-400">
                        <strong>Experimental</strong>. Grant access to a paid stream.
                        <strong>Content:</strong> Encrypted AES key for the stream (NIP-04 encrypted).
                    </p>
                    <pre><code>{`{
  "kind": 24242,
  "content": "<nip04_encrypted_stream_key>",
  "tags": [
    ["e", "<stream_event_original_id>"],
    ["p", "<viewer_pubkey>"] 
  ]
}`}</code></pre>

                    <h3 className="text-2xl mt-12 mb-4 font-mono">Cryptographic Primitives</h3>
                    <div className="space-y-6 text-sm text-neutral-400">
                        <div>
                            <strong className="text-white block mb-2">1. Stream Path Derivation (Anti-Hijack)</strong>
                            <p className="font-mono bg-neutral-900 p-3 rounded">
                                Input = pubkey:streamName<br />
                                Hash = SHA-256(Input)<br />
                                Path = Hash.hex().substring(0, 16)
                            </p>
                        </div>
                        <div>
                            <strong className="text-white block mb-2">2. Broadcast Authentication</strong>
                            <p className="font-mono bg-neutral-900 p-3 rounded">
                                Payload = path:timestamp<br />
                                Signature = Ed25519_Sign(Payload, PrivateKey)<br />
                                Request: ?pubkey=...&sig=...&t=...
                            </p>
                        </div>
                    </div>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-20 mb-12">5. Cryptoeconomics (Monero)</h2>
                    <p className="mb-8">dStream integrates Monero (XMR) to ensure financial privacy and censorship resistance.</p>

                    <h3 className="text-2xl mt-12 mb-6">5.1 Subaddress verification (tipping)</h3>
                    <p className="mb-4">
                        To prevent address reuse privacy leaks, the protocol generates a unique <strong>subaddress</strong> for every tip/transaction.
                    </p>
                    <ul className="space-y-3">
                        <li><strong>Derivation:</strong> <code>Ks = Hn(Kv || i)</code>, where <code>Kv</code> is the view key and <code>i</code> is the index.</li>
                        <li><strong>Flow:</strong>
                            <ol className="mt-2 space-y-2 list-decimal">
                                <li>Viewer requests tip invoice.</li>
                                <li>Client generates unique subaddress 8... (conceptually, or via centralized bridge for now).</li>
                                <li>Viewer sends XMR.</li>
                                <li>Broadcaster wallet scans blockchain for transaction to that subaddress.</li>
                            </ol>
                        </li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">5.2 P2P ticket granting (pay-per-view)</h3>
                    <p className="mb-4">For paid streams, dStream uses a cryptographic access token model.</p>
                    <ol className="space-y-4">
                        <li><strong>Gatekeeper:</strong> Broadcaster sets <code>price</code> tag in Kind <code>30311</code>.</li>
                        <li><strong>Payment:</strong> Viewer sends proof of payment (TxID or signed message).</li>
                        <li><strong>Grant:</strong> Broadcaster signs an <strong>access token</strong> (Kind <code>24242</code> - experimental).</li>
                        <li><strong>Access:</strong> Viewer decrypts the content (stream key) to access the HLS feed.</li>
                    </ol>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-20 mb-12">6. Security & threat model</h2>

                    <h3 className="text-2xl mt-12 mb-6">6.1 Sybil & spam attacks</h3>
                    <ul className="space-y-3">
                        <li><strong>Threat:</strong> Malicious actor floods relays with fake stream events.</li>
                        <li><strong>Mitigation:</strong> Relays can require Proof-of-Work (NIP-13) or payment for admission. Client-side filters prioritize "trusted peers" (web of trust).</li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">6.2 Content moderation</h3>
                    <ul className="space-y-3">
                        <li><strong>Approach:</strong> <strong>Client-side filtering</strong>, not server-side banning.</li>
                        <li><strong>Mechanism:</strong>
                            <ul className="mt-2 space-y-2">
                                <li>Users maintain a <code>contact_list</code> (Kind 3).</li>
                                <li>The UI filters out streams from pubkeys in the user's "mute list" or those not in their "web of trust" (optional).</li>
                                <li><strong>Result:</strong> "Freedom of Speech, not Freedom of Reach."</li>
                            </ul>
                        </li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">6.3 Privacy (IP leaks)</h3>
                    <ul className="space-y-3">
                        <li><strong>Risk:</strong> Accessing the HLS stream exposes viewer IP to ingest node.</li>
                        <li><strong>Mitigation:</strong> Users requiring anonymity MUST route traffic through <strong>Tor</strong> or a <strong>VPN</strong>. The protocol remains agnostic to the transport layer.</li>
                    </ul>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-20 mb-12">7. Reproducibility guide (run your own node)</h2>

                    <h3 className="text-2xl mt-12 mb-6">Prerequisites</h3>
                    <ul className="space-y-3">
                        <li><strong>Server:</strong> VPS with Docker installed (Ubuntu 22.04 recommended).</li>
                        <li><strong>Domain:</strong> A generic domain name (e.g., <code>mystream.com</code>).</li>
                        <li><strong>Ports:</strong> 80/443 (Web), 1935 (RTMP).</li>
                    </ul>

                    <h3 className="text-2xl mt-12 mb-6">Quick Start</h3>
                    <p className="mb-4">Clone the repository and run the setup script.</p>
                    <pre><code>{`git clone https://github.com/dstream-protocol/dstream
cd dstream/infra/prod
./setup_vps.sh`}</code></pre>

                    <h3 className="text-2xl mt-12 mb-6">Manual Configuration</h3>
                    <ol className="space-y-4">
                        <li><strong>MediaMTX:</strong> Configure <code>mediamtx.yml</code> to enable HLS and set <code>hlsVariant: lowLatency</code>.</li>
                        <li><strong>Web Client:</strong> Build the Next.js app (<code>apps/web</code>) and export as static site.</li>
                        <li><strong>Relay Connection:</strong> Edit <code>apps/web/lib/config.ts</code> to point to preferred Nostr relays (e.g., <code>wss://relay.damus.io</code>).</li>
                    </ol>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-20 mb-12">8. Mathematical references</h2>

                    <h3 className="text-2xl mt-12 mb-6">Swarm efficiency</h3>
                    <p className="mb-4">
                        The bandwidth load on the ingest server (<code>Bs</code>) approaches a constant as the number of peers (<code>N</code>) increases, assuming average upload capacity of peers (<code>Up</code>) exceeds stream bitrate (<code>R</code>).
                    </p>
                    <div className="bg-neutral-900 p-6 rounded-xl text-center my-8 font-mono text-base border border-neutral-800">
                        lim N→∞ Bs(N) ≈ k · R
                    </div>
                    <p>
                        Where <code>k</code> is the number of initial seeders (typically 1). If <code>Up &lt; R</code>, the swarm health degrades. dStream mitigates this by allowing the ingest server to act as a "Super Seeder" with high bandwidth.
                    </p>

                    <h3 className="text-2xl mt-12 mb-6">Schnorr signatures (identity)</h3>
                    <p className="mb-4">All events are signed using Schnorr signatures on the secp256k1 curve.</p>
                    <div className="bg-neutral-900 p-6 rounded-xl text-center my-8 font-mono text-base border border-neutral-800">
                        s = r + cx (mod n)
                    </div>
                    <ul className="space-y-2">
                        <li><code>s</code>: Signature</li>
                        <li><code>r</code>: Nonce</li>
                        <li><code>c</code>: Challenge Hash</li>
                        <li><code>x</code>: Private Key</li>
                    </ul>

                    <hr className="border-neutral-800 my-16" />

                    <h2 className="text-3xl mt-16 mb-8 text-center">Support the Mission</h2>
                    <p className="text-center text-neutral-400 mb-8 max-w-2xl mx-auto">
                        dStream is built and maintained by a small team dedicated to digital freedom.
                        Your support helps us pay for infrastructure and continue developing tools that protect free speech.
                    </p>
                    <div className="flex justify-center mb-16">
                        <button
                            onClick={() => setShowDonationModal(true)}
                            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-neutral-200 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-white/10"
                        >
                            <span className="text-xl">❤️</span>
                            Donate to dStream
                        </button>
                    </div>
                </article>
            </main>

            <footer className="border-t border-neutral-800 p-12 text-center text-neutral-300 text-sm mt-12">
                <p>dStream Protocol © 2025. Released under MIT License.</p>
            </footer>
        </div>
    );
}
