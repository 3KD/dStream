import Link from "next/link";
import { ArrowLeft, Shield, Mic, Globe, DollarSign, Lock, Radio } from "lucide-react";

export default function UseCasesPage() {
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-purple-500/30">

            {/* Header */}
            <header className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center backdrop-blur-md bg-black/20 border-b border-white/5">
                <Link href="/" className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                    <span className="font-medium">Back to Home</span>
                </Link>
                <div className="font-bold text-xl tracking-tighter">
                    <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">d</span>
                    <span className="bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">Stream</span>
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
                    <p className="text-xl md:text-2xl text-neutral-400 max-w-3xl mx-auto leading-relaxed">
                        We built dStream for those who cannot afford to be silenced, de-platformed, or demonetized by a central authority.
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
                        title="Activists & Whistleblowers"
                        subtitle="Operational security is not optional."
                        content="Broadcast from the front lines with plausible deniability. Our architecture supports routing through Tor/I2P (coming soon), and payments are private by default. Your location and identity are protected by math, not a corporate privacy policy."
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
                    <h2 className="text-3xl font-bold text-white mb-8">Ready to reclaim your voice?</h2>
                    <Link href="/broadcast" className="inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform">
                        Start Streaming Now
                    </Link>
                </section>

            </main>
        </div>
    );
}

function UseCaseCard({ icon, title, subtitle, content }: { icon: any, title: string, subtitle: string, content: string }) {
    return (
        <div className="group relative p-8 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-white/10 transition-all hover:bg-neutral-900/80">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

            <div className="relative z-10">
                <div className="mb-6 p-3 bg-white/5 w-fit rounded-xl border border-white/5 group-hover:scale-110 transition-transform duration-500">
                    {icon}
                </div>

                <h3 className="text-2xl font-bold text-white mb-2">{title}</h3>
                <p className="text-lg font-medium text-blue-400 mb-4">{subtitle}</p>
                <p className="text-neutral-400 leading-relaxed">
                    {content}
                </p>
            </div>
        </div>
    );
}
