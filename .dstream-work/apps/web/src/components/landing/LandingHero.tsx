"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { RotatingCube, WORDS, WORD_COLORS_HEX } from "@/components/landing/RotatingCube";

interface LandingHeroProps {
  primaryHref?: string;
  secondaryHref?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  collapseControl?: ReactNode;
}

export function LandingHero({
  primaryHref = "/broadcast",
  secondaryHref = "/browse",
  primaryLabel = "Start Streaming",
  secondaryLabel = "Browse Streams",
  collapseControl
}: LandingHeroProps) {
  const [currentWord, setCurrentWord] = useState(WORDS[0]);

  return (
    <section className="py-20 text-center space-y-6 overflow-x-clip">
      <div className="text-5xl md:text-8xl font-black tracking-tighter flex flex-col items-center justify-center gap-6">
        <RotatingCube onWordChange={setCurrentWord} />
        <span
          className="pb-[0.2em] transition-colors duration-[2000ms] ease-in-out"
          style={{ color: WORD_COLORS_HEX[currentWord] || "#a855f7" }}
        >
          Streaming
        </span>
      </div>

      <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
        <span className="text-blue-500">dStream</span> – World's first decentralized streaming protocol.
        <br />
        Freely built for people of the modern de-fi economy.
      </p>

      <div className="flex gap-4 justify-center pt-6">
        <Link
          href={primaryHref}
          className="px-8 py-4 bg-neutral-200 text-black font-bold rounded-full hover:bg-white hover:scale-105 hover:shadow-lg hover:shadow-white/20 active:scale-95 transition-all duration-200"
        >
          {primaryLabel}
        </Link>
        <Link
          href={secondaryHref}
          className="px-8 py-4 bg-neutral-600 border border-neutral-500 text-white font-bold rounded-full hover:bg-neutral-500 hover:scale-105 hover:shadow-lg hover:shadow-white/10 active:scale-95 transition-all duration-200"
        >
          {secondaryLabel}
        </Link>
      </div>

      {collapseControl ? <div className="flex justify-center pt-2">{collapseControl}</div> : null}
    </section>
  );
}
