"use client";

import { PreferencesEditor } from "@/components/settings/PreferencesEditor";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsPreferencesPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-4xl mx-auto p-8 space-y-8">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Preferences</h1>
            <p className="text-sm text-neutral-500">Local playback and network behaviors.</p>
          </div>
        </header>

        <SettingsNav />

        <div className="space-y-6">
          <PreferencesEditor />
        </div>
      </main>
    </div>
  );
}
      <PreferencesEditor />
