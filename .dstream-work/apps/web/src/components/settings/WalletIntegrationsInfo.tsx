"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ClipboardPaste, ExternalLink, Eye, EyeOff, PlugZap, Save, Trash2, Wifi } from "lucide-react";
import { WALLET_INTEGRATIONS, PAYMENT_ASSET_META } from "@/lib/payments/catalog";
import {
  clearNwcConnection,
  getNwcConnection,
  getNwcPersistence,
  saveNwcConnection,
  testNwcConnection
} from "@/lib/payments/lightningWallet";

export function walletModeLabel(mode: "native_app" | "browser_extension" | "external_cli") {
  if (mode === "browser_extension") return "Browser extension";
  if (mode === "external_cli") return "CLI / RPC";
  return "Native app";
}

export function walletModeHint(mode: "native_app" | "browser_extension" | "external_cli") {
  if (mode === "browser_extension") return "Use browser plugin confirmation when opening wallet URI from Watch page.";
  if (mode === "external_cli") return "Use local CLI/RPC workflow; copy address from Watch page and submit externally.";
  return "Open the native wallet app and send to the copied address or wallet URI target.";
}

export function WalletIntegrationsInfo() {
  const [nwcInput, setNwcInput] = useState("");
  const [nwcBusy, setNwcBusy] = useState(false);
  const [nwcVisible, setNwcVisible] = useState(false);
  const [rememberNwc, setRememberNwc] = useState(false);
  const [nwcStatus, setNwcStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [settlementCapabilities, setSettlementCapabilities] = useState<
    Array<{ asset: string; railId: string; network: string; configured: boolean; reason?: string }>
  >([]);

  useEffect(() => {
    setNwcInput(getNwcConnection());
    setRememberNwc(getNwcPersistence() === "device");
    let active = true;
    void fetch("/api/payments/capabilities", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (active && Array.isArray(body?.settlement)) setSettlementCapabilities(body.settlement);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const saveAndTestNwc = async () => {
    setNwcBusy(true);
    setNwcStatus(null);
    try {
      saveNwcConnection(nwcInput, { rememberOnDevice: rememberNwc });
      await testNwcConnection(nwcInput);
      setNwcStatus({ ok: true, message: "Connected" });
    } catch (error) {
      setNwcStatus({ ok: false, message: error instanceof Error ? error.message : "Connection failed" });
    } finally {
      setNwcBusy(false);
    }
  };

  const disconnectNwc = () => {
    clearNwcConnection();
    setNwcInput("");
    setNwcStatus({ ok: true, message: "Disconnected" });
  };

  const pasteNwc = async () => {
    setNwcStatus(null);
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error("Clipboard is empty");
      setNwcInput(value.trim());
    } catch (error) {
      setNwcStatus({ ok: false, message: error instanceof Error ? error.message : "Paste failed" });
    }
  };

  const walletIntegrationsByMode = useMemo(() => {
    const modes: Array<"native_app" | "browser_extension" | "external_cli"> = ["native_app", "browser_extension", "external_cli"];
    return modes.map((mode) => ({
      mode,
      wallets: WALLET_INTEGRATIONS.filter((wallet) => wallet.mode === mode)
    }));
  }, []);

  return (
    <section id="wallet-integrations" className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4 scroll-mt-24">
      <h2 className="text-sm font-semibold text-neutral-200 inline-flex items-center gap-2">
        <PlugZap className="w-4 h-4" />
        Wallet Integrations
      </h2>

      <div className="text-sm text-neutral-300 space-y-2">
        <p>
          Connect supported browser wallets for direct confirmation, or hand payments off through an address, QR code, or wallet URI.
          dStream never requests a seed phrase or private key.
        </p>
        <ol className="list-decimal pl-5 text-xs text-neutral-400 space-y-1">
          <li>Set preferred wallet per asset under Payment Defaults.</li>
          <li>Configure payout methods in Broadcast (core + advanced panel).</li>
          <li>On Watch, confirm with a detected wallet provider or open the native wallet handoff.</li>
        </ol>
      </div>

      <div className="border-y border-neutral-800 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-neutral-200">Nostr Wallet Connect</div>
            <div className="text-[11px] text-neutral-500">Lightning</div>
          </div>
          {nwcStatus ? (
            <span className={`inline-flex items-center gap-1 text-xs ${nwcStatus.ok ? "text-emerald-300" : "text-red-300"}`}>
              {nwcStatus.ok ? <Check className="h-3.5 w-3.5" /> : null}
              {nwcStatus.message}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex min-w-0 flex-1">
            <input
              type={nwcVisible ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={nwcInput}
              onChange={(event) => setNwcInput(event.target.value)}
              placeholder="nostr+walletconnect://..."
              aria-label="Nostr Wallet Connect secret"
              className="min-w-0 flex-1 rounded-l-md border border-r-0 border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setNwcVisible((current) => !current)}
              className="inline-flex h-9 w-9 items-center justify-center border border-neutral-700 bg-neutral-950 text-neutral-400 hover:text-neutral-200"
              title={nwcVisible ? "Hide connection secret" : "Show connection secret"}
              aria-label={nwcVisible ? "Hide connection secret" : "Show connection secret"}
            >
              {nwcVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void pasteNwc()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-r-md border border-l-0 border-neutral-700 bg-neutral-950 text-neutral-400 hover:text-neutral-200"
              title="Paste connection secret"
              aria-label="Paste connection secret"
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void saveAndTestNwc()}
            disabled={nwcBusy || !nwcInput.trim()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {nwcBusy ? <Wifi className="h-4 w-4 animate-pulse" /> : <Save className="h-4 w-4" />}
            {nwcBusy ? "Testing" : "Save and test"}
          </button>
          <button
            type="button"
            onClick={disconnectNwc}
            disabled={!nwcInput.trim()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Disconnect
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={rememberNwc}
            onChange={(event) => setRememberNwc(event.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          Remember this connection on this device
        </label>
      </div>

      {settlementCapabilities.length ? (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-neutral-200">Settlement verifiers</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {settlementCapabilities.map((capability) => (
              <div
                key={`${capability.railId}:${capability.asset}:${capability.network}`}
                className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2"
                title={capability.reason}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase text-neutral-200">{capability.asset}</div>
                  <div className="truncate text-[11px] text-neutral-500">{capability.railId} · {capability.network}</div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${capability.configured ? "text-emerald-300" : "text-amber-300"}`}>
                  {capability.configured ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {capability.configured ? "Active" : "Setup needed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {walletIntegrationsByMode.map(({ mode, wallets }) => (
          <article key={mode} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">{walletModeLabel(mode)}</div>
              <div className="text-xs text-neutral-500 mt-1">{walletModeHint(mode)}</div>
            </div>
            <div className="space-y-2">
              {wallets.map((wallet) => (
                <div key={wallet.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-200">{wallet.name}</div>
                    <a
                      href={wallet.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-300 hover:text-blue-200 inline-flex items-center gap-1"
                    >
                      Site <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Assets: {wallet.assets.map((asset) => PAYMENT_ASSET_META[asset].symbol).join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="text-xs text-neutral-500">
        Prefer a CLI wallet workflow? Set preferred wallet to Monero CLI / Bitcoin Core, then use Copy on watch page to pay from your terminal wallet.
      </div>
    </section>
  );
}
