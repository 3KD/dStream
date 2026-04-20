"use client";

import { OperatorConsole } from "@/components/settings/OperatorConsole";
import { PaymentDefaults } from "@/components/settings/PaymentDefaults";
import { WalletIntegrationsInfo } from "@/components/settings/WalletIntegrationsInfo";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsMonetizationPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Monetization</h1>
            <p className="text-sm text-neutral-500">Wallet integrations, payouts, and tipping logic.</p>
          </div>
        </header>

        <SettingsNav />

        <div className="space-y-6">
          <PaymentDefaults />
          <WalletIntegrationsInfo />
          <OperatorConsole mode="monetization" chrome="embedded" />
        </div>
      </main>
    </div>
  );
}
