"use client";

import { OperatorConsole } from "@/components/settings/OperatorConsole";
import { PaymentDefaults } from "@/components/settings/PaymentDefaults";
import { WalletIntegrationsInfo } from "@/components/settings/WalletIntegrationsInfo";

export default function SettingsMonetizationPage() {
  return (
    <div className="space-y-6">
      <PaymentDefaults />
      <WalletIntegrationsInfo />
      <OperatorConsole mode="monetization" />
    </div>
  );
}
