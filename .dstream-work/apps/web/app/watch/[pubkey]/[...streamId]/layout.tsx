/* eslint-disable @next/next/no-sync-scripts -- Chat relay startup must precede Next hydration on direct watch loads. */
import { getNostrRelays } from "@/lib/config";

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        src="/chat-prebootstrap.js"
        data-dstream-chat-prebootstrap="true"
        data-relays={JSON.stringify(getNostrRelays())}
      />
      {children}
    </>
  );
}
