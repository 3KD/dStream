"use client";

import type { ReactNode } from "react";
import { IdentityProvider } from "@/context/IdentityContext";
import { SocialProvider } from "@/context/SocialContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <IdentityProvider>
      <SocialProvider>{children}</SocialProvider>
    </IdentityProvider>
  );
}
