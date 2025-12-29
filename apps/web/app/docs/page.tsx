"use client";

import Link from "next/link";
import { ArrowLeft, Book, Shield, Lock, Radio, Zap, HelpCircle } from "lucide-react";
import { MoneroLogo } from "@/components/icons/MoneroLogo";

export default function DocsPage() {
    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <header className="border-b border-neutral-800 p-6 sticky top-0 bg-neutral-950/80 backdrop-blur z-50">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Home
                    </Link>
                    <h1 className="font-bold text-xl">dStream Documentation</h1>
                </div>
            </header>

            <main className="max-w-4xl mx-auto p-6 space-y-16">

                {/* Vision Section */}
                <section className="space-y-4">
                    <h2 className="text-4xl font-black bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                        The d-Series Vision
                    </h2>
                    <p className="text-xl text-neutral-400 leading-relaxed">
                        The <strong>"d"</strong> stands for <strong>DeFi</strong>.
                    </p>
                    <p className="text-neutral-400 leading-relaxed">
                        dStream is the first in a proposed series of independent, decentralized protocols designed to replace rent-seeking middlemen with
                        direct, p2p economic relationships. Just as dStream removes the platform tax from streaming, future d-Series apps (like decentralized ride-sharing)
                        will remove the platform tax from other gig economies.
                    </p>
                </section>

                <hr className="border-neutral-800" />

                {/* Introduction */}
                <section className="space-y-4">
                    <h2 className="text-3xl font-bold text-white">
                        How dStream Works
                    </h2>
                    <p className="text-xl text-neutral-400">
                        A simple guide to the privacy, identity, and economic features of the platform.
                    </p>
                </section>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Feature 1: Identity */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
                                <Shield className="w-5 h-5" />
                            </div>
                            <h3 className="text-2xl font-bold">Nostr Identity</h3>
                        </div>
                        <p className="text-neutral-400 leading-relaxed">
                            dStream uses <strong>Nostr</strong> for account management. Instead of a username and password stored on our servers, you own a
                            cryptographic key pair (Public/Private Key). This means:
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-2 ml-2">
                            <li>You can never be banned by a central server.</li>
                            <li>Your followers (contact list) move with you to any Nostr app.</li>
                            <li>You can log in using browser extensions like <strong>Alby</strong> or <strong>nos2x</strong> (NIP-07).</li>
                        </ul>
                    </div>

                    {/* Feature 2: P2P */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-900/30 rounded-lg text-green-400">
                                <Radio className="w-5 h-5" />
                            </div>
                            <h3 className="text-2xl font-bold">P2P Streaming</h3>
                        </div>
                        <p className="text-neutral-400 leading-relaxed">
                            Video is distributed using <strong>WebTorrent</strong>. When you watch a stream, your browser helps relay video segments to other nearby viewers.
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-2 ml-2">
                            <li>Reduces server costs for broadcasters to near-zero.</li>
                            <li>Makes the stream more resilient as more people watch.</li>
                            <li>No central CDN means no central censorship choke point.</li>
                        </ul>
                    </div>

                    {/* Feature 3: Monero */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
                                <MoneroLogo className="w-5 h-5" />
                            </div>
                            <h3 className="text-2xl font-bold">Monero Economy</h3>
                        </div>
                        <p className="text-neutral-400 leading-relaxed">
                            We believe financial privacy is a human right. dStream integrates <strong>Monero (XMR)</strong> for tipping.
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-2 ml-2">
                            <li><strong>Subaddresses:</strong> The app generates unique addresses for each payment to preserve your privacy.</li>
                            <li><strong>No KYC:</strong> No bank accounts, no ID verification, no permission needed.</li>
                            <li><strong>Escrow:</strong> Smart contracts allow holding funds until streaming milestones are met.</li>
                        </ul>
                    </div>

                    {/* Feature 4: Encryption */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400">
                                <Lock className="w-5 h-5" />
                            </div>
                            <h3 className="text-2xl font-bold">Encrypted Chat</h3>
                        </div>
                        <p className="text-neutral-400 leading-relaxed">
                            Chat messages can be public or private.
                        </p>
                        <ul className="list-disc list-inside text-neutral-400 space-y-2 ml-2">
                            <li><strong>Public:</strong> Visible to everyone in the room (signed events).</li>
                            <li><strong>Encrypted (NIP-04):</strong> Direct Messages to the host are end-to-end encrypted. Only you and the host can read them.</li>
                        </ul>
                    </div>
                </div>

                <hr className="border-neutral-800" />

                {/* FAQ Section */}
                <section className="space-y-8">
                    <div className="flex items-center gap-3">
                        <HelpCircle className="w-8 h-8 text-neutral-500" />
                        <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <h4 className="text-lg font-bold text-white mb-2">Do I need to install anything?</h4>
                            <p className="text-neutral-400">No! dStream runs entirely in your browser. However, for better security, we recommend installing a Nostr extension like <strong>Alby</strong> to manage your keys safely.</p>
                        </div>

                        <div>
                            <h4 className="text-lg font-bold text-white mb-2"> How do I get Monero?</h4>
                            <p className="text-neutral-400">You can acquire Monero (XMR) on various exchanges or via P2P markets like LocalMonero or Haveno. We do not sell crypto directly.</p>
                        </div>

                        <div>
                            <h4 className="text-lg font-bold text-white mb-2">Can I use OBS?</h4>
                            <p className="text-neutral-400">Yes. When you start a broadcast, we provide an <strong>RTMP URL</strong> and <strong>Stream Key</strong>. You can input these into OBS, Wirecast, or any standard streaming software.</p>
                        </div>

                        <div>
                            <h4 className="text-lg font-bold text-white mb-2">Is it really uncensorable?</h4>
                            <p className="text-neutral-400">
                                <strong>Identity:</strong> Yes, no one can take your keys.<br />
                                <strong>Video:</strong> Highly resistant. Because video is P2P, there isn't one single server to shut down. However, individual trackers can be blocked, which is why we use multiple redundant trackers.
                            </p>
                        </div>
                    </div>
                </section>

            </main>
        </div>
    );
}
