import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/context/Web3Provider";
import { IdentityProvider } from "@/context/IdentityContext";
import { TrustedPeersProvider } from "@/context/TrustedPeersContext";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { InboxProvider } from "@/context/InboxContext";
import { InboxModal } from "@/components/chat/InboxModal";
import { EscrowProvider } from "@/context/EscrowContext";
import { TipProvider } from "@/context/TipContext";
import { KeyringProvider } from "@/context/KeyringContext";
import { BroadcastProvider } from "@/context/BroadcastContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { StreamProvider } from "@/context/StreamContext";

export const metadata: Metadata = {
  title: "dStream | decentralized Streaming",
  description: "Decentralized live streaming with crypto tipping",
  icons: [
    { rel: 'icon', url: '/logo_circle.png' },
    { rel: 'apple-touch-icon', url: '/logo_circle.png' },
  ],
};

import { MiniPlayer } from "@/components/player/MiniPlayer";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <IdentityProvider>
          <KeyringProvider>
            <BroadcastProvider>
              <TrustedPeersProvider>
                <FavoritesProvider>
                  <InboxProvider>
                    <EscrowProvider>
                      <TipProvider>
                        <Web3Provider>
                          <StreamProvider>
                            {children}
                            <MiniPlayer />
                            <InboxModal />
                          </StreamProvider>
                        </Web3Provider>
                      </TipProvider>
                    </EscrowProvider>
                  </InboxProvider>
                </FavoritesProvider>
              </TrustedPeersProvider>
            </BroadcastProvider>
          </KeyringProvider>
        </IdentityProvider>
      </body>
    </html>
  );
}
