"use client";

import { useState, useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { Shield, Radio, Wallet, BarChart2, LayoutDashboard, Users, Video, PanelLeftClose, PanelLeft, Settings, Key } from "lucide-react";
import { ModerationView } from "@/components/dashboard/ModerationView";
import { StreamSettings } from "@/components/dashboard/StreamSettings";
import { GuildManagement } from "@/components/dashboard/GuildManagement";
import { MoneroManager } from "@/components/wallet/MoneroManager";
import { BrowseView } from "@/components/dashboard/BrowseView";
import { BroadcastView } from "@/components/dashboard/BroadcastView";
import { NostrIdentitySettings } from "@/components/dashboard/NostrIdentitySettings";
import { BackupRestore } from "@/components/settings/BackupRestore";
import { KeyringManager } from "@/components/settings/KeyringManager";
import { useStreamAnalytics } from "@/hooks/useStreamAnalytics";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function DashboardPage() {
    const { identity, isLoading } = useIdentity();
    const analytics = useStreamAnalytics(identity?.nostrPublicKey);
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const [activeTab, setActiveTab] = useState<"overview" | "moderation" | "settings" | "wallet" | "guilds" | "broadcast" | "account" | "identity" | "browse">("broadcast");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    // Set initial tab from URL param
    useEffect(() => {
        if (tabParam === "broadcast") setActiveTab("broadcast");
        else if (tabParam === "browse") setActiveTab("browse"); // Add browse param handling
        else if (tabParam === "settings") setActiveTab("settings");
        else if (tabParam === "moderation") setActiveTab("moderation");
        else if (tabParam === "wallet") setActiveTab("wallet");
        else if (tabParam === "guilds") setActiveTab("guilds");
        else if (tabParam === "account") setActiveTab("account");
        else if (tabParam === "identity") setActiveTab("identity");
    }, [tabParam]);

    // Protect Route
    useEffect(() => {
        if (!isLoading && !identity?.nostrPublicKey) {
            // In a real app we'd redirect, but for dev we might be in weird state.
            // Let's show a "Login Required" screen instead of hard redirect loop.
        }
    }, [isLoading, identity]);

    if (isLoading) {
        return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">Loading Dashboard...</div>;
    }

    if (!identity?.nostrPublicKey) {
        return (
            <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-4 text-center">
                <Shield className="w-16 h-16 text-neutral-600 mb-4" />
                <h1 className="text-3xl font-bold mb-2">Access Restricted</h1>
                <p className="text-neutral-400 mb-6">You must be logged in to access the Broadcaster Dashboard.</p>
                <Link href="/" className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold">
                    Return Home & Login
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col md:flex-row">
            {/* Sidebar */}
            <aside className={`bg-neutral-900 border-r border-neutral-800 flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-full md:w-64'}`}>
                {/* dStream Logo - Links Home */}
                <Link href="/" className={`p-4 border-b border-neutral-800 flex items-center gap-0 group ${sidebarCollapsed ? 'justify-center' : ''}`}>
                    <img
                        src="/logo_trimmed.png"
                        alt="dStream"
                        className="h-8 w-auto object-contain -translate-y-0.5 -mr-1 relative z-10 transition-transform group-hover:scale-105"
                    />
                    {!sidebarCollapsed && (
                        <span className="text-xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent relative z-0">
                            Stream
                        </span>
                    )}
                </Link>

                <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-3">
                    <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'hidden' : ''}`}>
                        <LayoutDashboard className="w-5 h-5 text-blue-500" />
                        <span className="font-bold text-sm tracking-tight">Dashboard</span>
                    </div>
                    <button
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {sidebarCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
                    </button>
                </div>

                <nav className={`p-4 space-y-2 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
                    <button
                        onClick={() => setActiveTab("broadcast")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "broadcast" ? "bg-gradient-to-r from-red-900/30 to-pink-900/30 text-red-400 border border-red-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Go Live"
                    >
                        <Video className="w-5 h-5" />
                        {!sidebarCollapsed && 'Go Live'}
                    </button>
                    <button
                        onClick={() => setActiveTab("browse")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "browse" ? "bg-purple-900/20 text-purple-400 border border-purple-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Browse Streams"
                    >
                        <Users className="w-5 h-5" />
                        {!sidebarCollapsed && 'Browse Streams'}
                    </button>

                    <div className="my-2 border-t border-neutral-800/50"></div>

                    <button
                        onClick={() => setActiveTab("overview")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "overview" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Overview"
                    >
                        <BarChart2 className="w-5 h-5" />
                        {!sidebarCollapsed && 'Overview'}
                    </button>
                    <button
                        onClick={() => setActiveTab("settings")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "settings" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Stream Settings"
                    >
                        <Radio className="w-5 h-5" />
                        {!sidebarCollapsed && 'Stream Settings'}
                    </button>
                    <button
                        onClick={() => setActiveTab("identity")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "identity" ? "bg-gradient-to-r from-purple-900/30 to-blue-900/30 text-purple-400 border border-purple-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Nostr Identity"
                    >
                        <Key className="w-5 h-5" />
                        {!sidebarCollapsed && 'Nostr Identity'}
                    </button>
                    <button
                        onClick={() => setActiveTab("moderation")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "moderation" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Moderation"
                    >
                        <Shield className="w-5 h-5" />
                        {!sidebarCollapsed && 'Moderation'}
                    </button>
                    <button
                        onClick={() => setActiveTab("guilds")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "guilds" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Guilds"
                    >
                        <Users className="w-5 h-5" />
                        {!sidebarCollapsed && 'Guilds'}
                    </button>
                    <button
                        onClick={() => setActiveTab("wallet")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "wallet" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Wallet"
                    >
                        <Wallet className="w-5 h-5" />
                        {!sidebarCollapsed && 'Wallet'}
                    </button>
                    <button
                        onClick={() => setActiveTab("account")}
                        className={`${sidebarCollapsed ? 'p-3' : 'w-full flex items-center gap-3 px-4 py-3'} rounded-lg font-medium transition-colors ${activeTab === "account" ? "bg-blue-900/20 text-blue-400 border border-blue-900/50" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
                        title="Account"
                    >
                        <Settings className="w-5 h-5" />
                        {!sidebarCollapsed && 'Account'}
                    </button>

                </nav>

                {!sidebarCollapsed && (
                    <div className="mt-auto p-4 border-t border-neutral-800">
                        <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2">
                            <div className="flex items-center gap-3">
                                {identity.picture ? (
                                    <img
                                        src={identity.picture}
                                        alt="Profile"
                                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                <div className={`w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex-shrink-0 ${identity.picture ? 'hidden' : ''}`} />
                                <div className="overflow-hidden flex-1">
                                    <div className="font-bold text-sm truncate">{identity.displayName || "Broadcaster"}</div>
                                </div>
                            </div>
                            {/* Nostr Identity */}
                            <div className="pt-2 border-t border-neutral-800/50 space-y-1">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(identity.nostrPublicKey || '');
                                        // Could add toast here
                                    }}
                                    className="w-full text-left group"
                                    title="Click to copy npub"
                                >
                                    <div className="text-[10px] text-purple-500 font-bold uppercase tracking-wider">Nostr (npub)</div>
                                    <div className="text-xs text-neutral-400 font-mono truncate group-hover:text-white transition-colors">
                                        {identity.nostrPublicKey.substring(0, 16)}...
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(identity.publicKey);
                                    }}
                                    className="w-full text-left group"
                                    title="Click to copy Protocol key"
                                >
                                    <div className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Protocol (Ed25519)</div>
                                    <div className="text-xs text-neutral-400 font-mono truncate group-hover:text-white transition-colors">
                                        {identity.publicKey.substring(0, 16)}...
                                    </div>
                                </button>
                            </div>
                        </div>
                        <Link href="/" className="block mt-4 text-center text-xs text-neutral-500 hover:text-white">
                            ← Back to Stream
                        </Link>
                        <a href="https://github.com/3KD/dStream" target="_blank" rel="noopener noreferrer" className="block mt-2 text-center text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
                            Open Source (GitHub)
                        </a>
                    </div>
                )}
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-6 md:p-10 overflow-y-auto">
                <header className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold">
                        {activeTab === "overview" && "Channel Overview"}
                        {activeTab === "broadcast" && "Go Live"}
                        {activeTab === "browse" && "Browse Live Streams"}
                        {activeTab === "settings" && "Stream Settings"}
                        {activeTab === "moderation" && "Moderation & Safety"}
                        {activeTab === "guilds" && "Guild Management"}
                        {activeTab === "wallet" && "My Wallet"}
                        {activeTab === "account" && "Account Settings"}
                        {activeTab === "identity" && "Nostr Identity"}
                    </h1>
                    {/* Could add quick actions here */}
                </header>

                {/* Broadcast tab gets full width for video expansion */}
                <div className={activeTab === "broadcast" ? "" : "max-w-6xl"}>
                    {activeTab === "overview" && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
                                <div className="text-neutral-400 text-sm mb-1">Total Zaps</div>
                                <div className="text-3xl font-bold">{analytics.loading ? "--" : analytics.totalZaps}</div>
                                <div className="text-xs text-neutral-500 mt-2">Lifetime interactions</div>
                            </div>
                            <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
                                <div className="text-neutral-400 text-sm mb-1">Reactions</div>
                                <div className="text-3xl font-bold">{analytics.loading ? "--" : analytics.reactionCount}</div>
                                <div className="text-xs text-neutral-500 mt-2">Likes & Boosts</div>
                            </div>
                            <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl">
                                <div className="text-neutral-400 text-sm mb-1">Est. Earnings</div>
                                <div className="text-3xl font-bold text-orange-500">{analytics.loading ? "--" : analytics.totalZapAmount.toLocaleString()} Sats</div>
                                <div className="text-xs text-neutral-500 mt-2">From Lightning Zaps</div>
                            </div>

                            <div className="col-span-full bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center text-neutral-500">
                                <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <h3 className="text-lg font-medium mb-2">Analytics Coming Soon</h3>
                                <p>We are building detailed analytics for your p2p stream performance.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === "broadcast" && <BroadcastView />}
                    {activeTab === "browse" && <BrowseView />}
                    {activeTab === "moderation" && <ModerationView />}
                    {activeTab === "settings" && <StreamSettings />}
                    {activeTab === "guilds" && <GuildManagement />}
                    {activeTab === "wallet" && <MoneroManager />}
                    {activeTab === "account" && (
                        <div className="space-y-8">
                            <BackupRestore />
                            <KeyringManager />
                        </div>
                    )}
                    {activeTab === "identity" && <NostrIdentitySettings />}
                </div>
            </main>
        </div>
    );
}
