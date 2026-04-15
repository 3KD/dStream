"use client";

import type { ReactNode } from "react";
import { IdentityProvider } from "@/context/IdentityContext";
import { QuickPlayProvider } from "@/context/QuickPlayContext";
import { SocialProvider } from "@/context/SocialContext";
import { GlobalPlayerProvider } from "@/context/GlobalPlayerContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <IdentityProvider>
      <SocialProvider>
        <QuickPlayProvider>
          <GlobalPlayerProvider>{children}</GlobalPlayerProvider>
        </QuickPlayProvider>
      </SocialProvider>
    </IdentityProvider>
  );
}
