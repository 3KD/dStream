"use client";

import Link from "next/link";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { LandingHero } from "@/components/landing/LandingHero";

export default function VisualsClient() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />

      <main className="max-w-7xl mx-auto p-6 space-y-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Visuals Kit</h1>
          <p className="text-sm text-neutral-400">
            Dev-only page for the landing animations (rotating cube + word color sync) and brand assets.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/" className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800">
              Home
            </Link>
            <Link
              href="/dev/e2e"
              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
            >
              Dev E2E
            </Link>
          </div>
        </header>

        <LandingHero />

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-2 text-sm text-neutral-300">
          <div className="font-semibold text-white">Where this lives</div>
          <ul className="space-y-1 text-neutral-300">
            <li>
              Cube + word list: <span className="font-mono text-neutral-200">apps/web/src/components/landing/RotatingCube.tsx</span>
            </li>
            <li>
              Hero wrapper: <span className="font-mono text-neutral-200">apps/web/src/components/landing/LandingHero.tsx</span>
            </li>
            <li>
              Cube CSS: <span className="font-mono text-neutral-200">apps/web/app/globals.css</span> (<span className="font-mono">.machined-*</span>)
            </li>
            <li>
              Logo asset: <span className="font-mono text-neutral-200">apps/web/public/logo_trimmed.png</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

