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
  const showHeaderSearch = pathname !== "/";
  const navClassName =
    "inline-flex items-center rounded-lg border border-neutral-800/90 bg-neutral-900/40 px-2.5 py-1 text-xs sm:text-sm text-neutral-300 hover:border-neutral-700 hover:text-white transition-colors whitespace-nowrap leading-none";

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
    <header className="relative isolate border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md z-[80] px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6">
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
                  className="flex h-8 w-44 items-center rounded-lg border border-neutral-700 bg-neutral-900/90 px-2 text-neutral-200 sm:h-9 sm:w-56 md:w-64"
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
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 sm:w-9 sm:h-9"
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
