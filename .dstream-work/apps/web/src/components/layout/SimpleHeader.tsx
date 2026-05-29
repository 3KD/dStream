"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { IdentityButton } from "@/components/IdentityButton";

interface SimpleHeaderProps {
  rightSlot?: ReactNode;
}

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: "/browse", label: "Browse" },
  { href: "/guilds", label: "Guilds" },
  { href: "/inbox", label: "Inbox" },
  { href: "/moderation", label: "Moderation" },
  { href: "/settings", label: "Settings" }
];

export function SimpleHeader({ rightSlot }: SimpleHeaderProps) {
  const showDevLinks = process.env.NODE_ENV === "development";
  const pathname = usePathname();
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const showHeaderSearch = true;
  const navClassName =
    "inline-flex shrink-0 items-center rounded-lg border border-neutral-800/90 bg-neutral-900/40 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-700 hover:text-white transition-colors whitespace-nowrap leading-none sm:px-2.5 sm:text-sm";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = (new URLSearchParams(window.location.search).get("q") ?? "").trim();
    setSearchText(query);
  }, [pathname]);

  useEffect(() => {
    if (!showHeaderSearch) setIsSearchOpen(false);
  }, [showHeaderSearch]);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    router.push(query ? `/browse?q=${encodeURIComponent(query)}` : "/browse");
  };

  return (
    <header className="relative isolate z-[80] border-b border-neutral-800 bg-neutral-950/90 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-2.5 lg:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="group flex min-w-0 shrink-0 items-center">
            <img
              src="/logo_trimmed.png"
              alt="dStream Logo"
              className="relative z-10 h-7 w-auto shrink-0 object-contain -mr-[0.1em] transition-transform group-hover:scale-105 sm:h-10 md:h-11"
            />
            <span className="relative z-0 whitespace-nowrap bg-gradient-to-r from-purple-600 via-blue-500 to-cyan-400 bg-clip-text text-xl font-black leading-none tracking-tight text-transparent sm:text-3xl md:text-4xl">
              Stream
            </span>
          </Link>

          <nav className="hidden md:flex landscape:flex flex-1 min-w-0 justify-start lg:justify-center overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center justify-start lg:justify-center gap-1.5 px-1">
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
            {showHeaderSearch &&
              (isSearchOpen ? (
                <form
                  onSubmit={submitSearch}
                  className="flex h-8 w-[min(11rem,calc(100vw-8.75rem))] items-center rounded-lg border border-neutral-700 bg-neutral-900/90 px-2 text-neutral-200 sm:h-9 sm:w-56 md:w-64"
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setIsSearchOpen(false);
                    }}
                    placeholder="Search streams"
                    className="ml-2 min-w-0 flex-1 bg-transparent text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none sm:text-sm"
                    aria-label="Search streams"
                  />
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                    aria-label="Close search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 sm:h-9 sm:w-9"
                  aria-label="Open search"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              ))}
            <IdentityButton />
          </div>
        </div>

        <nav className="md:hidden landscape:hidden mt-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
