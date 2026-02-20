"use client";
import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IdentityButton } from '@/components/IdentityButton';
import { ProfileDisplay } from '@/components/ProfileDisplay';

interface DashboardLayoutProps {
    children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const pathname = usePathname();

    const navItems = [
        { label: 'Browse', href: '/browse', icon: '🔍' },
        { label: 'Broadcast', href: '/broadcast', icon: '🎥' },
        // { label: 'Guilds', href: '/guilds', icon: '🏰' },
        // { label: 'Inbox', href: '/inbox', icon: '✉️' },
        // { label: 'Settings', href: '/settings', icon: '⚙️' },
    ];

    return (
        <div className="flex h-screen bg-black text-white overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 border-r border-neutral-800 bg-neutral-900/50 flex flex-col">
                <div className="p-6">
                    <Link href="/" className="flex items-center gap-2 group">
                        <img
                            src="/logo_trimmed.png"
                            alt="dStream"
                            className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
                        />
                        <span className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                            dStream
                        </span>
                    </Link>
                </div>

                <nav className="flex-1 px-4 space-y-1">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${pathname === item.href
                                ? 'bg-blue-600 text-white'
                                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                                }`}
                        >
                            <span>{item.icon}</span>
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    ))}
                </nav>

                {/* User Section */}
                <div className="p-4 border-t border-neutral-800">
                    <div className="mb-4">
                        <IdentityButton />
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-neutral-800/50">
                        <ProfileDisplay size="sm" />
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto relative">
                {children}
            </main>
        </div>
    );
}
