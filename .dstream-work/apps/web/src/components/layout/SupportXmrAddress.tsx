"use client";

import { useCallback, useState } from "react";

function shortAddress(value: string) {
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
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

export function SupportXmrAddress({ address }: { address: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const onCopy = useCallback(async () => {
    try {
      await copyText(address);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 1800);
    }
  }, [address]);

  return (
    <div className="text-xs text-neutral-400 font-mono">
      <span className="mr-2">XMR:</span>
      <button
        type="button"
        onClick={() => void onCopy()}
        className="inline-flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1 text-neutral-300 hover:text-white transition-colors"
        title={address}
        aria-label="Copy Monero support address"
      >
        <span>{shortAddress(address)}</span>
        <span className="text-[10px] text-neutral-500">{copyState === "copied" ? "copied" : copyState === "failed" ? "failed" : "copy"}</span>
      </button>
    </div>
  );
}
