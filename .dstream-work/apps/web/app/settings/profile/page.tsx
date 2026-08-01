"use client";

import { ProfileMetadataEditor } from "@/components/settings/ProfileMetadataEditor";
import { EmoteManager } from "@/components/settings/EmoteManager";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsProfilePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8 space-y-7">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Profile</h1>
            <p className="text-sm text-neutral-500">Public metadata and custom emotes.</p>
          </div>
        </header>

        <SettingsNav />

        <div className="space-y-7">
          <ProfileMetadataEditor />
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Custom emotes</h2>
              <p className="mt-1 text-xs text-neutral-500">Manage the emotes viewers can use in your chat.</p>
            </div>
            <EmoteManager />
          </section>
        </div>
      </main>
    </div>
  );
}
