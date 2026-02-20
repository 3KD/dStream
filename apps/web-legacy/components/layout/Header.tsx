"use client";

import Link from "next/link";
import { useState } from "react";
import {
    Mail,
    LayoutDashboard,
    UserCog,
    Shield,
    Radio,
    Compass,
    Heart,
    Menu,
    X
} from "lucide-react";
import { IdentityBadge } from "@/components/identity/IdentityBadge";
import { useInbox } from "@/context/InboxContext";
import { KeyringModal } from "@/components/settings/KeyringModal";
import { ProfileEditor } from "@/components/identity/ProfileEditor";
import { PlatformDonationModal } from "@/components/tipping/PlatformDonationModal";
import { useBroadcast } from "@/context/BroadcastContext";

interface HeaderProps {
    showBroadcastButton?: boolean;
    children?: React.ReactNode;
}

export function Header({ showBroadcastButton = true, children }: HeaderProps) {
    const { openInbox, unreadCount } = useInbox();
    const { isLive, session } = useBroadcast();
    const [showKeyring, setShowKeyring] = useState(false);
    const [showProfileEditor, setShowProfileEditor] = useState(false);
    const [showDonationModal, setShowDonationModal] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <>
            <header className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50 p-4 md:p-6">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    {/* Logo Section */}
                    <Link href="/" className="flex items-center gap-0 group">
                        <img
                            src="/logo_trimmed.png"
                            alt="dStream Logo"
                            className="h-8 md:h-12 w-auto object-contain -translate-y-0.5 md:-translate-y-1 -mr-1 md:-mr-1.5 relative z-10 transition-transform group-hover:scale-105"
                        />
                        <h1 className="text-2xl md:text-4xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent hidden sm:block relative z-0">
                            Stream
                        </h1>
                    </Link>

                    {/* LIVE Indicator - Show when broadcasting */}
                    {isLive && (
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600/20 border border-red-500/50 rounded-full hover:bg-red-600/30 transition-colors"
                            title={`Live: ${session?.streamKey || 'Stream'}`}
                        >
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-red-400 text-sm font-bold tracking-wider">LIVE</span>
                        </Link>
                    )}

                    {/* Actions Section */}
                    <div className="flex gap-2 md:gap-4 items-center">
                        {/* Hamburger Menu Button - Mobile Only */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800 md:hidden"
                            title="Menu"
                        >
                            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>

                        {/* Desktop Nav Icons - Hidden on Mobile */}
                        <div className="hidden md:flex gap-2 items-center">
                            {/* Browse */}
                            <Link
                                href="/browse"
                                className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                                title="Browse Streams"
                            >
                                <Compass className="w-5 h-5" />
                            </Link>

                            {/* Keyring / Trust */}
                            <button
                                onClick={() => setShowKeyring(true)}
                                className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                                title="Manage Trusted Keyring"
                            >
                                <Shield className="w-5 h-5" />
                            </button>

                            {/* Inbox */}
                            <button
                                onClick={openInbox}
                                className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800 relative"
                                title="Messages"
                            >
                                <Mail className="w-5 h-5" />
                                {unreadCount > 0 && (
                                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-neutral-900" />
                                )}
                            </button>

                            {/* Dashboard */}
                            <Link
                                href="/dashboard"
                                className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                                title="Broadcaster Dashboard"
                            >
                                <LayoutDashboard className="w-5 h-5" />
                            </Link>

                            {/* Edit Profile */}
                            <button
                                onClick={() => setShowProfileEditor(true)}
                                className="p-2 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                                title="Edit Nostr Profile"
                            >
                                <UserCog className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Page Specific Actions */}
                        {children}

                        {/* Support dStream */}
                        <button
                            onClick={() => setShowDonationModal(true)}
                            className="p-2 rounded-lg transition-colors text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            title="Support dStream"
                        >
                            <Heart className="w-5 h-5" />
                        </button>

                        {/* Divider */}
                        <div className="w-px h-6 bg-neutral-800 mx-1 hidden md:block" />

                        {/* Identity Pill */}
                        <IdentityBadge hideActions={true} />

                        {/* Start Streaming Button (Optional) */}
                        {showBroadcastButton && (
                            <Link
                                href="/dashboard?tab=broadcast"
                                className="hidden md:flex px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-full font-medium items-center gap-2 transition active:scale-95"
                            >
                                <Radio className="w-4 h-4" />
                                Start Streaming
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {/* Mobile Menu Dropdown */}
            {mobileMenuOpen && (
                <div className="md:hidden fixed top-[65px] left-0 right-0 bg-neutral-950/95 backdrop-blur-md border-b border-neutral-800 z-40 animate-in slide-in-from-top-2 duration-200">
                    <div className="max-w-7xl mx-auto p-4 flex flex-col gap-2">
                        <Link
                            href="/browse"
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-3 p-3 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                        >
                            <Compass className="w-5 h-5" />
                            <span>Browse Streams</span>
                        </Link>

                        <button
                            onClick={() => { setShowKeyring(true); setMobileMenuOpen(false); }}
                            className="flex items-center gap-3 p-3 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800 text-left"
                        >
                            <Shield className="w-5 h-5" />
                            <span>Trusted Keyring</span>
                        </button>

                        <button
                            onClick={() => { openInbox(); setMobileMenuOpen(false); }}
                            className="flex items-center gap-3 p-3 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800 text-left relative"
                        >
                            <Mail className="w-5 h-5" />
                            <span>Messages</span>
                            {unreadCount > 0 && (
                                <span className="ml-auto px-2 py-0.5 text-xs bg-red-500 rounded-full">{unreadCount}</span>
                            )}
                        </button>

                        <Link
                            href="/dashboard"
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-3 p-3 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800"
                        >
                            <LayoutDashboard className="w-5 h-5" />
                            <span>Dashboard</span>
                        </Link>

                        <button
                            onClick={() => { setShowProfileEditor(true); setMobileMenuOpen(false); }}
                            className="flex items-center gap-3 p-3 rounded-lg transition-colors text-neutral-400 hover:text-white hover:bg-neutral-800 text-left"
                        >
                            <UserCog className="w-5 h-5" />
                            <span>Edit Profile</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Modals */}
            {showKeyring && <KeyringModal onClose={() => setShowKeyring(false)} />}
            <ProfileEditor isOpen={showProfileEditor} onClose={() => setShowProfileEditor(false)} />
            <PlatformDonationModal isOpen={showDonationModal} onClose={() => setShowDonationModal(false)} />
        </>
    );
}
