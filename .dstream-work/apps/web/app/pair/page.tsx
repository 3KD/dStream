"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Smartphone } from "lucide-react";
import { SimpleHeader } from "@/components/layout/SimpleHeader";

interface PairPayload {
  v: number;
  t: string;
  edge: string;
  relays: string[];
  tok: string;
}

export default function PairPage() {
  const [payload, setPayload] = useState<PairPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pair");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: PairPayload = await res.json();
      setPayload(data);

      // Generate QR code.
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(JSON.stringify(data), {
        width: 400,
        margin: 2,
        color: { dark: "#ffffff", light: "#00000000" },
      });
      setQrDataUrl(url);
    } catch (e: any) {
      setError(e.message || "Failed to generate pairing code");
      setPayload(null);
      setQrDataUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    generate();
  }, [generate]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SimpleHeader />
      <main className="max-w-lg mx-auto px-6 py-12 space-y-8">
        <div className="text-center space-y-2">
          <Smartphone className="w-10 h-10 mx-auto text-blue-500" />
          <h1 className="text-2xl font-bold">Pair Mobile App</h1>
          <p className="text-neutral-400 text-sm">
            Open dStream on your phone and scan this QR code to connect to this node.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm text-center">
            {error}
          </div>
        )}

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col items-center gap-6">
          {loading && !qrDataUrl && (
            <div className="w-[280px] h-[280px] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="Pairing QR code"
              className="w-[280px] h-[280px]"
            />
          )}

          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 text-sm bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        </div>

        {payload && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-3 text-sm">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Manual setup (fallback)</h2>
            <div>
              <span className="text-neutral-500">Edge URL: </span>
              <code className="text-neutral-200 font-mono text-xs break-all">{payload.edge}</code>
            </div>
            <div>
              <span className="text-neutral-500">Relays: </span>
              <div className="mt-1 space-y-1">
                {payload.relays.map((r) => (
                  <code key={r} className="block text-neutral-200 font-mono text-xs break-all">{r}</code>
                ))}
              </div>
            </div>
            <p className="text-xs text-neutral-600">
              Token expires in 10 minutes. Regenerate if it fails.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
