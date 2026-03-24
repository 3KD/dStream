"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NOSTR_RELAY_OVERRIDE_STORAGE_KEY, parseRelayList } from "@/lib/config";

function sanitizeNextPath(input: string | null): string {
  const raw = (input ?? "").trim();
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

function MobileBootstrapInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Applying mobile configuration…");

  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get("next")), [searchParams]);
  const relays = useMemo(() => parseRelayList(searchParams.get("relays")), [searchParams]);

  useEffect(() => {
    try {
      if (relays.length > 0) {
        localStorage.setItem(NOSTR_RELAY_OVERRIDE_STORAGE_KEY, relays.join(","));
      }
      localStorage.setItem("dstream_mobile_bootstrap_at_v1", String(Date.now()));
      setStatus("Configuration applied. Opening dStream…");
      router.replace(nextPath);
    } catch {
      setStatus("Failed to apply mobile configuration. Continue to app.");
      router.replace(nextPath);
    }
  }, [nextPath, relays, router]);

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3">
        <h1 className="text-lg font-semibold">dStream Mobile</h1>
        <p className="text-sm text-neutral-300">{status}</p>
        {relays.length > 0 ? <p className="text-xs text-neutral-500">Relay override applied: {relays.length} relay(s).</p> : null}
      </div>
    </main>
  );
}

function MobileBootstrapFallback() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3">
        <h1 className="text-lg font-semibold">dStream Mobile</h1>
        <p className="text-sm text-neutral-300">Loading mobile configuration…</p>
      </div>
    </main>
  );
}

export default function MobileBootstrapPage() {
  return (
    <Suspense fallback={<MobileBootstrapFallback />}>
      <MobileBootstrapInner />
    </Suspense>
  );
}
