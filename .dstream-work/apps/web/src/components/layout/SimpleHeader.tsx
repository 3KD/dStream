"use client";

import type { ReactNode } from "react";
import { Mail, Settings } from "lucide-react";
import { IdentityButton } from "@/components/IdentityButton";

interface SimpleHeaderProps {
  rightSlot?: ReactNode;
}

export function SimpleHeader({ rightSlot }: SimpleHeaderProps) {
  const showDevLinks = process.env.NODE_ENV === "development";
  return (
    <header className="relative isolate border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-[80] p-4 md:p-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-0 group">
          <img
            src="/logo_trimmed.png"
            alt="dStream Logo"
            className="h-8 md:h-12 w-auto object-contain -translate-y-0.5 md:-translate-y-1 -mr-1 md:-mr-1.5 relative z-10 transition-transform group-hover:scale-105"
          />
          <span className="text-2xl md:text-4xl font-black tracking-tighter bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent hidden sm:block relative z-0">
            Stream
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-4 text-sm text-neutral-300">
          <a href="/browse" className="hover:text-white transition-colors">
            Browse
          </a>
          <a href="/guilds" className="hover:text-white transition-colors">
            Guilds
          </a>
          <a href="/inbox" className="hover:text-white transition-colors">
            Inbox
          </a>
          <a href="/broadcast" className="hover:text-white transition-colors">
            Broadcast
          </a>
          <a href="/dashboard" className="hover:text-white transition-colors">
            Dashboard
          </a>
          <a href="/profile" className="hover:text-white transition-colors">
            Profile
          </a>
          <a href="/moderation" className="hover:text-white transition-colors">
            Moderation
          </a>
          <a href="/settings" className="hover:text-white transition-colors">
            Settings
          </a>
          {showDevLinks && (
            <a href="/dev/visuals" className="hover:text-white transition-colors text-neutral-400">
              Visuals
            </a>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {rightSlot}
          <a
            href="/inbox"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
            aria-label="Inbox"
          >
            <Mail className="w-4 h-4" />
          </a>
          <a
            href="/settings"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </a>
          <IdentityButton />
        </div>
      </div>
    </header>
  );
}
