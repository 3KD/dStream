"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Mail, Settings } from "lucide-react";
import { IdentityButton } from "@/components/IdentityButton";

interface SimpleHeaderProps {
  rightSlot?: ReactNode;
}

export function SimpleHeader({ rightSlot }: SimpleHeaderProps) {
  const showDevLinks = process.env.NODE_ENV === "development";
  return (
    <header className="sticky top-0 z-[1000] border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 py-4 md:px-6 md:py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo_trimmed.png"
            alt="dStream Logo"
            className="h-8 md:h-12 w-auto object-contain -translate-y-0.5 md:-translate-y-1 -mr-1 md:-mr-1.5 relative z-10 transition-transform group-hover:scale-105"
          />
          <span className="text-2xl md:text-4xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent hidden sm:block relative z-0">
            Stream
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-4 text-sm text-neutral-300 pointer-events-auto">
          <Link href="/browse" className="hover:text-white transition-colors">
            Browse
          </Link>
          <Link href="/guilds" className="hover:text-white transition-colors">
            Guilds
          </Link>
          <Link href="/inbox" className="hover:text-white transition-colors">
            Inbox
          </Link>
          <Link href="/broadcast" className="hover:text-white transition-colors">
            Broadcast
          </Link>
          <Link href="/dashboard" className="hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/profile" className="hover:text-white transition-colors">
            Profile
          </Link>
          <Link href="/moderation" className="hover:text-white transition-colors">
            Moderation
          </Link>
          <Link href="/settings" className="hover:text-white transition-colors">
            Settings
          </Link>
          {showDevLinks && (
            <Link href="/dev/visuals" className="hover:text-white transition-colors text-neutral-400">
              Visuals
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {rightSlot}
          <Link
            href="/inbox"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
            aria-label="Inbox"
          >
            <Mail className="w-4 h-4" />
          </Link>
          <Link
            href="/settings"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <IdentityButton />
        </div>
      </div>
    </header>
  );
}
