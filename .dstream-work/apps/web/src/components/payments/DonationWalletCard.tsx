"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, QrCode, Wallet } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";

interface DonationWalletCardProps {
  name: string;
  symbol: string;
  network: string;
  address: string;
  walletUri: string;
  symbolClassName: string;
  walletLabel?: string;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function DonationWalletCard({
  name,
  symbol,
  network,
  address,
  walletUri,
  symbolClassName,
  walletLabel = "Configured wallet"
}: DonationWalletCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(walletUri, {
      width: 176,
      margin: 1,
      color: { dark: "#0a0a0a", light: "#ffffff" }
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });

    return () => {
      active = false;
    };
  }, [walletUri]);

  const onCopy = useCallback(async () => {
    try {
      await copyText(address);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [address]);

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${symbolClassName}`}>
            {symbol}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">{name}</h2>
            <p className="text-xs text-neutral-400">{network}</p>
          </div>
        </div>
        <span className="shrink-0 rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-1 text-[11px] font-medium text-emerald-300">
          {walletLabel}
        </span>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_176px] sm:items-start">
        <div className="min-w-0 space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase text-neutral-500">Receive address</p>
            <p className="break-all font-mono text-sm leading-6 text-neutral-200">{address}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
            >
              {copyState === "copied" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy address"}
            </button>
            <a
              href={walletUri}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <Wallet className="h-4 w-4" />
              Open wallet
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <div className="flex h-44 w-44 items-center justify-center overflow-hidden rounded-md bg-white" aria-label={`${name} payment QR code`}>
          {qrDataUrl ? (
            <Image src={qrDataUrl} alt={`${name} payment QR code`} width={176} height={176} unoptimized />
          ) : (
            <QrCode className="h-8 w-8 text-neutral-400" aria-hidden="true" />
          )}
        </div>
      </div>
    </article>
  );
}
