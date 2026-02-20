"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Mail, Settings } from "lucide-react";
import { IdentityButton } from "@/components/IdentityButton";

interface SimpleHeaderProps {
  rightSlot?: ReactNode;
}

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: "/browse", label: "Browse" },
  { href: "/guilds", label: "Guilds" },
  { href: "/inbox", label: "Inbox" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/moderation", label: "Moderation" },
  { href: "/community-guidelines", label: "Guidelines" },
  { href: "/settings", label: "Settings" }
];

export function SimpleHeader({ rightSlot }: SimpleHeaderProps) {
  const showDevLinks = process.env.NODE_ENV === "development";
  const navClassName =
    "inline-flex items-center rounded-lg border border-neutral-800/90 bg-neutral-900/40 px-2.5 py-1.5 text-xs sm:text-sm text-neutral-300 hover:border-neutral-700 hover:text-white transition-colors whitespace-nowrap";

  return (
    <header className="relative isolate border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-[80] px-3 py-2.5 sm:px-4 sm:py-3 lg:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-1.5 sm:gap-2 group min-w-0 shrink-0">
            <img
              src="/logo_trimmed.png"
              alt="dStream Logo"
              className="h-7 sm:h-8 md:h-9 w-auto object-contain relative z-10 transition-transform group-hover:scale-105 shrink-0"
            />
            <span className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight leading-none bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent relative z-0 whitespace-nowrap">
              Stream
            </span>
          </Link>

          <nav className="hidden md:block min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-1.5 pr-2">
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className={navClassName}>
                  {item.label}
                </Link>
              ))}
              {showDevLinks && (
                <Link href="/dev/visuals" className={`${navClassName} text-neutral-400`}>
                  Visuals
                </Link>
              )}
            </div>
          </nav>

          <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
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

        <nav className="md:hidden mt-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center gap-1.5">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className={navClassName}>
                {item.label}
              </Link>
            ))}
            {showDevLinks && (
              <Link href="/dev/visuals" className={`${navClassName} text-neutral-400`}>
                Visuals
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
