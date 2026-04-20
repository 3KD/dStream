"use client";

import { ProfileMetadataEditor } from "@/components/settings/ProfileMetadataEditor";
import { EmoteManager } from "@/components/settings/EmoteManager";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsProfilePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Profile</h1>
            <p className="text-sm text-neutral-500">Public metadata and custom emotes.</p>
          </div>
        </header>

        <SettingsNav />

        <div className="space-y-6">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-neutral-200">Public Profile</h2>
            <ProfileMetadataEditor />
          </section>
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-neutral-200">Custom Emotes</h2>
            <EmoteManager />
          </section>
        </div>
      </main>
    </div>
  );
}
