import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SiteFooterWrapper } from "@/components/layout/SiteFooterWrapper";
import { GlobalQuickPlayDock } from "@/components/player/GlobalQuickPlayDock";
import { GlobalStreamDirectoryPrefetch } from "@/components/stream/GlobalStreamDirectoryPrefetch";

const FAVICON_URL = "/logo_favicon_aligned.png?v=3";

export const metadata: Metadata = {
  title: "dStream",
  description: "World's first decentralized streaming protocol. Built for people of the modern de-fi economy.",
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
        <Providers>
          <div className="min-h-screen flex flex-col">
            <GlobalStreamDirectoryPrefetch />
            <div className="flex-1">{children}</div>
            <SiteFooterWrapper />
            <GlobalQuickPlayDock />
          </div>
        </Providers>
      </body>
    </html>
  );
}
