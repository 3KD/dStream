"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Book, Shield, Lock, Radio, Zap, HelpCircle, Network, Search, ShieldAlert } from "lucide-react";
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { PlatformDonationModal } from "@/components/tipping/PlatformDonationModal";

export default function DocsPage() {
    const [showDonationModal, setShowDonationModal] = useState(false);
    return (
        <div className="min-h-screen bg-neutral-950 text-white pb-20">
            <header className="border-b border-neutral-800 p-6 sticky top-0 bg-neutral-950/80 backdrop-blur z-50">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition group">
                        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                        Back to Home
                    </Link>
                    <div className="flex items-center gap-2">
                        <Book className="w-5 h-5 text-blue-500" />
                        <h1 className="font-bold text-xl uppercase tracking-widest text-neutral-400">Documentation</h1>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 md:py-16 space-y-24">

                {/* Getting Started Guide */}
                <section className="space-y-12">
                    <div className="text-center space-y-4">
                        <h2 className="text-5xl font-black bg-gradient-to-r from-white to-neutral-500 bg-clip-text text-transparent italic">
                            Getting Started
                        </h2>
                        <p className="text-xl text-neutral-500 max-w-2xl mx-auto">
                            Welcome to the future of broadcasting. dStream is different by design. Here is how to navigate the network.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-4 gap-8">
                        {/* Step 1: Watch */}
                        <div className="p-6 bg-neutral-900/40 border border-neutral-800 rounded-2xl space-y-4 hover:border-blue-500/30 transition-all group">
                            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                <Radio className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold">1. Watch</h3>
                            <p className="text-neutral-400 text-sm leading-relaxed">
                                Simply click any live stream to start watching. You don't need an account or any crypto to enjoy content.
                            </p>
                        </div>

                        {/* Step 2: Connect */}
                        <div className="p-6 bg-neutral-900/40 border border-neutral-800 rounded-2xl space-y-4 hover:border-purple-500/30 transition-all group">
                            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                                <Shield className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold">2. Connect</h3>
                            <p className="text-neutral-400 text-sm leading-relaxed">
                                Use a **Nostr** key to manage your identity. Use browser extensions like Alby for a seamless login.
                            </p>
                        </div>

                        {/* Step 3: Interact */}
                        <div className="p-6 bg-neutral-900/40 border border-neutral-800 rounded-2xl space-y-4 hover:border-orange-500/30 transition-all group">
                            <div className="w-12 h-12 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-400 group-hover:scale-110 transition-transform">
                                <MoneroLogo className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold">3. Support</h3>
                            <p className="text-neutral-400 text-sm leading-relaxed">
                                Tip your favorite creators directly using **Monero**. Private, instant, and 100% direct to the broadcaster.
                            </p>
                        </div>

                        {/* Step 4: Broadcast */}
                        <div className="p-6 bg-neutral-900/40 border border-neutral-800 rounded-2xl space-y-4 hover:border-green-500/30 transition-all group">
                            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center text-green-400 group-hover:scale-110 transition-transform">
                                <Zap className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold">4. Go Live</h3>
                            <p className="text-neutral-400 text-sm leading-relaxed">
                                Head to the Broadcaster Dashboard to get your RTMP details. OBS setup takes less than 2 minutes.
                            </p>
                        </div>
                    </div>
                </section>

                <hr className="border-neutral-900" />

                {/* Advanced Features Guide */}
                <section className="space-y-12">
                    <h2 className="text-3xl font-bold text-center">Feature Guide</h2>

                    <div className="grid md:grid-cols-2 gap-8">
                        {/* Search */}
                        <div className="border border-neutral-800 bg-neutral-900/30 p-6 rounded-2xl">
                            <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                                <Search className="w-5 h-5 text-blue-500" />
                                Global Search
                            </h3>
                            <ul className="space-y-2 text-neutral-400 text-sm">
                                <li>• <strong>Filter Mode:</strong> Type in the search bar to instantly filter currently live streams.</li>
                                <li>• <strong>Global Network:</strong> Press <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-xs border border-neutral-700 font-mono">Enter</kbd> to search the entire Nostr network for offline channels and user profiles.</li>
                            </ul>
                        </div>

                        {/* Chat Console */}
                        <div className="border border-neutral-800 bg-neutral-900/30 p-6 rounded-2xl">
                            <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                                <Zap className="w-5 h-5 text-purple-500" />
                                Chat Console
                            </h3>
                            <div className="space-y-3 text-sm text-neutral-400">
                                <p>Power users can control chat using slash commands:</p>
                                <ul className="space-y-1 font-mono text-xs bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                                    <li><span className="text-blue-400">/name</span> @user Alias <span className="text-neutral-600 ml-2">// Set local nickname</span></li>
                                    <li><span className="text-purple-400">/wh</span>(user1,user2) msg <span className="text-neutral-600 ml-2">// Multi-user whisper</span></li>
                                    <li><span className="text-red-400">/ban</span> @user <span className="text-neutral-600 ml-2">// Ban (Broadcaster only)</span></li>
                                    <li><span className="text-green-400">/unban</span> @user <span className="text-neutral-600 ml-2">// Unban</span></li>
                                </ul>
                            </div>
                        </div>

                        {/* Moderation */}
                        <div className="border border-neutral-800 bg-neutral-900/30 p-6 rounded-2xl">
                            <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                                <ShieldAlert className="w-5 h-5 text-red-500" />
                                Moderation
                            </h3>
                            <p className="text-neutral-400 text-sm mb-2">
                                Broadcasters have full sovereignty. Banning a user:
                            </p>
                            <ul className="list-disc pl-5 text-neutral-400 text-sm space-y-1">
                                <li>Mutes them locally in your chat.</li>
                                <li>Adds them to your <strong>Nostr Mute List</strong> (Kind 10000).</li>
                                <li>Syncs across devices.</li>
                                <li>Manage bans in <strong>Dashboard &gt; Settings</strong>.</li>
                            </ul>
                        </div>

                        {/* Inbox */}
                        <div className="border border-neutral-800 bg-neutral-900/30 p-6 rounded-2xl">
                            <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                                <Lock className="w-5 h-5 text-green-500" />
                                Encrypted Inbox
                            </h3>
                            <p className="text-neutral-400 text-sm">
                                Your Inbox uses standard <strong>NIP-04 Direct Messages</strong>.
                                Messages sent here are persistent and visible in any major Nostr client.
                                Use this for coordination outside of live streams.
                            </p>
                        </div>
                    </div>
                </section>

                <hr className="border-neutral-900" />

                {/* Vision Section */}
                <section className="grid lg:grid-cols-2 gap-16 items-center">
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-bold uppercase tracking-wider">
                            Our Mission
                        </div>
                        <h2 className="text-4xl font-black leading-tight italic">
                            The Decentralized<br />
                            <span className="text-blue-500 italic">"d-Series"</span> Vision
                        </h2>
                        <p className="text-lg text-neutral-400 leading-relaxed">
                            dStream is the first protocol in the <strong>d-Series</strong>. Our goal is to replace rent-seeking middlemen across all digital services with direct, peer-to-peer economic relationships.
                        </p>
                        <p className="text-neutral-500 leading-relaxed">
                            Just as we've removed the platform tax from streaming, future d-Series applications will decentralize ride-sharing, food delivery, and the entire gig economy.
                        </p>
                    </div>
                    <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Zap className="w-48 h-48 text-blue-500" />
                        </div>
                        <h3 className="text-2xl font-bold mb-6">Built for Creators</h3>
                        <ul className="space-y-4">
                            {[
                                "Zero Platform Fees (0%)",
                                "Immutable Audience Ownership",
                                "Censorship-Resistant Hosting",
                                "Private, Non-KYC Economy"
                            ].map((item, i) => (
                                <li key={i} className="flex items-center gap-3 text-neutral-300">
                                    <Zap className="w-4 h-4 text-blue-500 fill-current" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <hr className="border-neutral-900" />

                {/* Deep Dives */}
                <section className="space-y-12">
                    <h2 className="text-3xl font-bold text-center">Protocol Deep Dives</h2>
                    <div className="grid md:grid-cols-2 gap-12">
                        {/* Detail: Identity */}
                        <div className="space-y-4 p-8 bg-neutral-900/20 border border-neutral-800/50 rounded-3xl">
                            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400 w-fit">
                                <Shield className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold">Nostr Identity</h3>
                            <p className="text-neutral-400 leading-relaxed">
                                No email, no central database. You own your public and private keys. Your followers are shared across all Nostr apps, meaning you can never be de-platformed or silenced.
                            </p>
                        </div>

                        {/* Detail: Distribution */}
                        <div className="space-y-4 p-8 bg-neutral-900/20 border border-neutral-800/50 rounded-3xl">
                            <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400 w-fit">
                                <Network className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold">WebTorrent Distribution</h3>
                            <p className="text-neutral-400 leading-relaxed">
                                Every viewer is also a relay. By sharing video segments directly with other peers, the network scales automatically as audience size grows, making it impossible to bottleneck.
                            </p>
                        </div>

                        {/* Detail: Economy */}
                        <div className="space-y-4 p-8 bg-neutral-900/20 border border-neutral-800/50 rounded-3xl">
                            <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400 w-fit">
                                <MoneroLogo className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold">Monero Economy</h3>
                            <p className="text-neutral-400 leading-relaxed">
                                Financial privacy is non-negotiable. dStream uses Monero to ensure that tipping remains private and untraceable, protected from the reach of traditional banking filters.
                            </p>
                        </div>

                        {/* Detail: Chat */}
                        <div className="space-y-4 p-8 bg-neutral-900/20 border border-neutral-800/50 rounded-3xl">
                            <div className="p-2 bg-neutral-800 rounded-lg text-neutral-400 w-fit">
                                <Lock className="w-6 h-6" />
                            </div>
                            <h3 className="text-2xl font-bold">Encrypted Whisper</h3>
                            <p className="text-neutral-400 leading-relaxed">
                                Built-in end-to-end encryption for private direct messages between viewers and broadcasters. Privacy is the default state of the JRNY network.
                            </p>
                        </div>
                    </div>
                </section>

                <hr className="border-neutral-900" />

                {/* FAQ Section */}
                <section className="space-y-12">
                    <div className="flex items-center gap-3 justify-center">
                        <HelpCircle className="w-8 h-8 text-neutral-700" />
                        <h2 className="text-3xl font-bold">Common Questions</h2>
                    </div>

                    <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
                        <div className="space-y-2">
                            <h4 className="text-lg font-bold text-white">Do I need an account to watch?</h4>
                            <p className="text-neutral-500">No. The network is open and permissionless. Simply find a stream and click play. No sign-up required.</p>
                        </div>

                        <div className="space-y-2">
                            <h4 className="text-lg font-bold text-white">How do I get Monero?</h4>
                            <p className="text-neutral-500">Monero (XMR) can be acquired through decentralized exchanges like LocalMonero, Haveno, or standard exchange platforms.</p>
                        </div>

                        <div className="space-y-2">
                            <h4 className="text-lg font-bold text-white">Can I use OBS Studio?</h4>
                            <p className="text-neutral-500">Yes! dStream supports standard RTMP ingest. You can use OBS, vMix, or any software that supports RTMP/WHIP streaming.</p>
                        </div>

                        <div className="space-y-2">
                            <h4 className="text-lg font-bold text-white">Is it truly uncensorable?</h4>
                            <p className="text-neutral-400">
                                Yes. Because your identity is a key and the video is shared among peers, there is no central entity that can take you offline.
                            </p>
                        </div>
                    </div>
                </section>

            </main>

            <PlatformDonationModal isOpen={showDonationModal} onClose={() => setShowDonationModal(false)} />

            <footer className="max-w-4xl mx-auto border-t border-neutral-900 pt-16 text-center space-y-6">
                <p className="text-neutral-500 text-sm italic">
                    "The only way to preserve freedom is to build it into the code."
                </p>
                <div className="flex justify-center gap-8 items-center">
                    <Link href="/whitepaper" className="text-blue-500 hover:underline">Technical Whitepaper</Link>
                    <a href="https://github.com/dstream-protocol" className="text-orange-500 hover:underline">Source Code</a>
                    <button
                        onClick={() => setShowDonationModal(true)}
                        className="text-green-400 hover:text-green-300 transition font-medium"
                    >
                        ❤️ Support dStream
                    </button>
                </div>
            </footer>
        </div >
    );
}
