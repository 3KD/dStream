"use client";

import { useState } from "react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { VodLibraryPanel } from "@/components/settings/VodLibraryPanel";
import { VodAccessPackagesPanel } from "@/components/settings/VodAccessPackagesPanel";
import { useIdentity } from "@/context/IdentityContext";
import { Shield } from "lucide-react";
import Link from "next/link";

type Tab = "library" | "packages";

export default function SettingsVodPage() {
  const { identity, isLoading } = useIdentity();
  const [tab, setTab] = useState<Tab>("library");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <SimpleHeader />
        <main className="max-w-2xl mx-auto px-6 py-20 text-center">
          <Shield className="w-12 h-12 mx-auto text-neutral-600 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Sign In Required</h1>
          <p className="text-neutral-400 mb-6">Connect an identity to manage VOD content.</p>
          <Link href="/settings" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold">
            Settings
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">VOD Management</h1>
            <p className="text-sm text-neutral-500 mt-1">Upload videos, manage playlists, and configure access packages.</p>
          </div>
          <Link
            href="/settings"
            className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs text-neutral-300"
          >
            Back to Settings
          </Link>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab("library")}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${
              tab === "library"
                ? "bg-blue-600/20 border border-blue-500/40 text-blue-200"
                : "bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300"
            }`}
          >
            Library &amp; Uploads
          </button>
          <button
            onClick={() => setTab("packages")}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${
              tab === "packages"
                ? "bg-blue-600/20 border border-blue-500/40 text-blue-200"
                : "bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300"
            }`}
          >
            Access Packages
          </button>
        </div>

        {tab === "library" && <VodLibraryPanel />}
        {tab === "packages" && <VodAccessPackagesPanel />}
      </main>
    </div>
  );
}
