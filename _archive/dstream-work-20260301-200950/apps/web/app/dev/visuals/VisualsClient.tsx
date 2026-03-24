"use client";

import Link from "next/link";
import { useState } from "react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import type { CubeVisualMode } from "@/components/landing/RotatingCube";

export default function VisualsClient() {
  const [cubeMode, setCubeMode] = useState<CubeVisualMode>("disco");

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

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">Cube mode</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCubeMode("disco")}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                cubeMode === "disco"
                  ? "bg-cyan-400/20 border-cyan-300/50 text-cyan-100"
                  : "bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              Disco mode
            </button>
            <button
              type="button"
              onClick={() => setCubeMode("psychedelic")}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                cubeMode === "psychedelic"
                  ? "bg-fuchsia-400/20 border-fuchsia-300/50 text-fuchsia-100"
                  : "bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              Psychedelic mode
            </button>
          </div>
          <p className="text-sm text-neutral-400">
            In psychedelic mode, edge nodes carry live values and face-center nodes are derived from opposing-edge products. Click the
            cube to reseed and toggle random oscillation.
          </p>
        </section>

        <LandingHero cubeMode={cubeMode} />

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
