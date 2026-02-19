"use client";

import type { ReactNode } from "react";
import { IdentityProvider } from "@/context/IdentityContext";
import { QuickPlayProvider } from "@/context/QuickPlayContext";
import { SocialProvider } from "@/context/SocialContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <IdentityProvider>
      <SocialProvider>
        <QuickPlayProvider>{children}</QuickPlayProvider>
      </SocialProvider>
    </IdentityProvider>
  );
}
