"use client";

import { useState, useEffect } from "react";
import { useIdentity } from "@/context/IdentityContext";
import { Shield, Radio, Wallet, BarChart2, LayoutDashboard, Users, Video, PanelLeftClose, PanelLeft, Settings, Key } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyringManager } from "@/components/settings/KeyringManager";
import { P2PStats } from "@/components/P2PStats";

// Simplify Dashboard for now by reusing existing components or providing links
export default function DashboardPage() {
    const { identity, isLoading } = useIdentity();
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const [activeTab, setActiveTab] = useState<"overview" | "settings" | "wallet" | "guilds" | "broadcast" | "account" | "identity" | "browse">("broadcast");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        if (tabParam === "broadcast") setActiveTab("broadcast");
        else if (tabParam === "browse") setActiveTab("browse");
        else if (tabParam === "settings") setActiveTab("settings");
        else if (tabParam === "wallet") setActiveTab("wallet");
        else if (tabParam === "guilds") setActiveTab("guilds");
        else if (tabParam === "account") setActiveTab("account");
        else if (tabParam === "identity") setActiveTab("identity");
    }, [tabParam]);

    if (isLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

    if (!identity) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-4 text-center">
                <Shield className="w-16 h-16 text-neutral-600 mb-4" />
                <h1 className="text-3xl font-bold mb-2">Access Restricted</h1>
                <p className="text-neutral-400 mb-6">You must be logged in to access the Dashboard.</p>
                <Link href="/" className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold">
                    Return Home & Login
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex flex-col md:flex-row">
            {/* Sidebar */}
            <aside className={`bg-neutral-900 border-r border-neutral-800 flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-full md:w-64'}`}>
                <Link href="/" className="p-4 border-b border-neutral-800 flex items-center gap-2 group">
                    <img src="/logo_trimmed.png" alt="dStream" className="h-8 w-auto object-contain" />
                    {!sidebarCollapsed && <span className="text-xl font-bold tracking-tighter">dStream</span>}
                </Link>

                <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-3">
                    {!sidebarCollapsed && (
                        <div className="flex items-center gap-3">
                            <LayoutDashboard className="w-5 h-5 text-blue-500" />
                            <span className="font-bold text-sm">Dashboard</span>
                        </div>
                    )}
                    <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-2 hover:bg-neutral-800 rounded-lg">
                        {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                    </button>
                </div>

                <nav className="p-4 space-y-2">
                    <button onClick={() => setActiveTab("broadcast")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${activeTab === "broadcast" ? "bg-red-900/20 text-red-400" : "hover:bg-neutral-800"}`}>
                        <Video className="w-5 h-5" />
                        {!sidebarCollapsed && "Go Live"}
                    </button>
                    <button onClick={() => setActiveTab("settings")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${activeTab === "settings" ? "bg-blue-900/20 text-blue-400" : "hover:bg-neutral-800"}`}>
                        <Settings className="w-5 h-5" />
                        {!sidebarCollapsed && "Settings"}
                    </button>
                    <button onClick={() => setActiveTab("account")} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${activeTab === "account" ? "bg-purple-900/20 text-purple-400" : "hover:bg-neutral-800"}`}>
                        <Key className="w-5 h-5" />
                        {!sidebarCollapsed && "Keyring"}
                    </button>
                </nav>
            </aside>

            {/* Content */}
            <main className="flex-1 p-6 overflow-y-auto">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold capitalize">{activeTab.replace('-', ' ')}</h1>
                </header>

                <div className="max-w-4xl">
                    {activeTab === "broadcast" && (
                        <div className="space-y-6">
                            <div className="p-6 bg-neutral-900 rounded-xl border border-neutral-800">
                                <h3 className="text-xl font-bold mb-4">Quick Start</h3>
                                <Link href="/broadcast" className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-bold inline-flex items-center gap-2">
                                    <Radio className="w-5 h-5" /> Launch Studio
                                </Link>
                            </div>
                            <P2PStats />
                        </div>
                    )}

                    {activeTab === "settings" && (
                        <div className="p-6 bg-neutral-900 rounded-xl border border-neutral-800 text-center text-neutral-500">
                            Settings Coming Soon
                        </div>
                    )}

                    {activeTab === "account" && <KeyringManager />}
                </div>
            </main>
        </div>
    );
}
