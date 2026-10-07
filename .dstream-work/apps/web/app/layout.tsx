import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { GlobalQuickPlayDock } from "@/components/player/GlobalQuickPlayDock";
import { EarlyWatchChatBootstrap } from "@/components/chat/EarlyWatchChatBootstrap";

const FAVICON_URL = "/logo_favicon_aligned.png?v=3";

export const metadata: Metadata = {
  title: "dStream",
  description: "Live streaming with portable Nostr identity, peer-assisted delivery, and direct noncustodial payments.",
  icons: {
    icon: FAVICON_URL
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={FAVICON_URL} />
      </head>
      <body className="min-h-screen bg-neutral-950 text-white">
        <EarlyWatchChatBootstrap />
        <Providers>
          <div className="min-h-screen flex flex-col">
            <div className="flex-1">{children}</div>
            <SiteFooter />
            <GlobalQuickPlayDock />
          </div>
        </Providers>
      </body>
    </html>
  );
}
