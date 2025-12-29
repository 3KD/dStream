import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/context/Web3Provider";
import { IdentityProvider } from "@/context/IdentityContext";
import { TrustedPeersProvider } from "@/context/TrustedPeersContext";
import { EscrowProvider } from "@/context/EscrowContext";
import { TipProvider } from "@/context/TipContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "dStream | Ownerless P2P Live Streaming",
  description: "Decentralized live streaming with crypto tipping",
};

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
        <IdentityProvider>
          <TrustedPeersProvider>
            <EscrowProvider>
              <TipProvider>
                <Web3Provider>
                  {children}
                </Web3Provider>
              </TipProvider>
            </EscrowProvider>
          </TrustedPeersProvider>
        </IdentityProvider>
      </body>
    </html>
  );
}
