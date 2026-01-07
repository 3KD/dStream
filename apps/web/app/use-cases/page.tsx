"use client";

import Link from "next/link";
import { ArrowLeft, Shield, Mic, Globe, DollarSign, Lock, Radio } from "lucide-react";
import { useState } from "react";
import { PlatformDonationModal } from "@/components/tipping/PlatformDonationModal";

export default function UseCasesPage() {
    const [showDonationModal, setShowDonationModal] = useState(false);
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-purple-500/30">
            <PlatformDonationModal isOpen={showDonationModal} onClose={() => setShowDonationModal(false)} />

            {/* Header */}
            <header className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-md bg-black/20 border-b border-white/5">
                <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                    <span className="font-medium">Back to Home</span>
                </Link>

                <div className="flex items-center gap-6">
                    <Link href="/whitepaper" className="hidden md:block text-neutral-400 hover:text-white transition text-sm font-medium">
                        Read Whitepaper
                    </Link>
                    <Link href="/" className="flex items-center gap-0">
                        <img
                            src="/logo_trimmed.png"
                            alt="Stream Logo"
                            className="h-8 md:h-10 w-auto object-contain -translate-y-0.5 md:-translate-y-1 -mr-0.5 md:-mr-1"
                        />
                        <span className="text-3xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent hidden md:block">
                            Stream
                        </span>
                    </Link>
                </div>
            </header>

            <main className="pt-32 pb-20 px-6 max-w-7xl mx-auto">

                {/* Hero Section */}
                <section className="mb-24 text-center">
                    <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6">
                        <span className="bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
                            Who needs this?
                        </span>
                    </h1>
                    <p className="text-xl md:text-2xl text-neutral-400 max-w-4xl mx-auto leading-relaxed">
                        We built dStream to empower creators with absolute ownership of their channel,
                        <br />
                        direct financial sovereignty, and limitless global reach.
                    </p>
                </section>

                {/* Use Cases Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">

                    {/* Journalists */}
                    <UseCaseCard
                        icon={<Shield className="w-8 h-8 text-blue-400" />}
                        title="Independent Journalists"
                        subtitle="Broadcast without fear of censorship."
                        content="When the story you're telling threatens powerful interests, centralized platforms will shut you down. dStream is built on p2p protocols that no single entity controls. Your stream cannot be taken down, your archives cannot be deleted, and your identity can remain pseudonymous."
                    />

                    {/* Musicians */}
                    <UseCaseCard
                        icon={<Mic className="w-8 h-8 text-purple-400" />}
                        title="Musicians & Performers"
                        subtitle="Keep 100% of your earnings."
                        content="Stop paying 30-50% to platforms just for the privilege of streaming. With direct crypto tipping (Monero/BTC) and peer-to-peer ticketing, you keep every cent from your fans. No middleman, no chargebacks, no demonetization algorithms."
                    />

                    {/* Streamers */}
                    <UseCaseCard
                        icon={<Radio className="w-8 h-8 text-red-400" />}
                        title="Pro Streamers"
                        subtitle="True ownership of your audience."
                        content="On Twitch or YouTube, you are a tenant. They own your audience, and they can evict you anytime. On dStream, your followers connect to you via Nostr—an open protocol. You own your social graph. If you move, your audience comes with you automatically."
                    />

                    {/* Activists */}
                    <UseCaseCard
                        icon={<Lock className="w-8 h-8 text-emerald-400" />}
                        title="Activists & Protestors"
                        subtitle="Operational security is not optional."
                        content="Broadcast from the front lines of any protest with plausible deniability. Whether organizing demonstrations or blowing the whistle on corruption, your identity is protected by math, not a corporate privacy policy."
                    />

                    {/* Educators */}
                    <UseCaseCard
                        icon={<Globe className="w-8 h-8 text-amber-400" />}
                        title="Uncensored Educators"
                        subtitle="Teach what others won't."
                        content="Whether it's controversial history, sensitive medical information, or political theory, education should not be filtered by 'Trust & Safety' teams. Build a paid community of learners that cannot be shut down by advertisers."
                    />

                    {/* Organizations */}
                    <UseCaseCard
                        icon={<DollarSign className="w-8 h-8 text-cyan-400" />}
                        title="DAOs & Collectives"
                        subtitle="Governance-owned media."
                        content="Run a 24/7 community broadcast that is owned by your token holders. Revenue flows directly into the DAO treasury. Moderation rights can be voted on and distributed. It is the ultimate tool for decentralized organizations."
                    />

                </div>

                {/* Call to Action */}
                <section className="mt-32 text-center">
                    <h2 className="text-3xl font-bold text-white mb-8">Ready to share your voice?</h2>
                    <div className="flex justify-center gap-4">
                        <Link href="/broadcast" className="inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform">
                            Start Streaming Now
                        </Link>
                        <Link href="/whitepaper" className="inline-flex items-center gap-3 px-8 py-4 bg-neutral-900 border border-neutral-800 text-white font-bold rounded-full hover:bg-neutral-800 transition-colors">
                            Read the Whitepaper
                        </Link>
                    </div>
                </section>
                {/* Donation CTA */}
                <section className="mt-32 pt-20 border-t border-white/5 text-center">
                    <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6 bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">
                        Help dStream Grow
                    </h2>
                    <p className="text-xl text-neutral-400 max-w-2xl mx-auto mb-10">
                        dStream is built for creators, by creators. Your support keeps the protocol independent and the servers running.
                    </p>
                    <div className="flex justify-center flex-col items-center gap-4">
                        <button
                            onClick={() => setShowDonationModal(true)}
                            className="inline-flex items-center gap-2 px-10 py-5 bg-white text-black font-bold rounded-full hover:bg-neutral-200 transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-white/10"
                        >
                            <span className="text-2xl">❤️</span>
                            Donate to dStream
                        </button>
                        <p className="text-xs text-neutral-500">Every donation helps us stay decentralized and free.</p>
                    </div>
                </section>
            </main>
        </div>
    );
}

function UseCaseCard({ icon, title, subtitle, content }: { icon: any, title: string, subtitle: string, content: string }) {
    return (
        <div className="group relative p-6 pt-10 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-white/20 transition-all hover:bg-neutral-900/80 overflow-hidden">
            {/* Large Background Icon (faded) */}
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-30 transition pointer-events-none [&>svg]:w-24 [&>svg]:h-24">
                {icon}
            </div>

            {/* Gradient overlay on hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

            <div className="relative z-10">
                {/* Title with icon */}
                <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                        {icon}
                    </div>
                    <h3 className="text-xl font-bold text-white">{title}</h3>
                </div>

                <p className="text-md font-medium text-blue-400 mb-4 pl-[15%]">{subtitle}</p>
                <p className="text-neutral-400 leading-relaxed text-sm">
                    {content}
                </p>
            </div>
        </div>
    );
}
