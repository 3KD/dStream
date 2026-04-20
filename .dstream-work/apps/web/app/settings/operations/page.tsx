"use client";

import { OperatorConsole } from "@/components/settings/OperatorConsole";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsOperationsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Operations</h1>
            <p className="text-sm text-neutral-500">Stream state, announce status, chat, presence, and relay configuration.</p>
          </div>
        </header>

        <SettingsNav />

        <OperatorConsole mode="operations" chrome="embedded" />
      </main>
    </div>
  );
}
