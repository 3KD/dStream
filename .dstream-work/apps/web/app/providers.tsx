"use client";

import type { ReactNode } from "react";
import { IdentityProvider } from "@/context/IdentityContext";
import { QuickPlayProvider } from "@/context/QuickPlayContext";
import { SocialProvider } from "@/context/SocialContext";
import { LocalRelayInit } from "@/components/session/LocalRelayInit";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <IdentityProvider>
      <LocalRelayInit />
      <SocialProvider>
        <QuickPlayProvider>{children}</QuickPlayProvider>
      </SocialProvider>
    </IdentityProvider>
  );
}
