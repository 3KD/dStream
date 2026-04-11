"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTipSession } from "@/hooks/useTipSession";

interface TipDialogProps {
  open: boolean;
  streamPubkey: string;
  streamId: string;
  broadcasterName?: string;
  onClose: () => void;
}

export function TipDialog({ open, streamPubkey, streamId, broadcasterName, onClose }: TipDialogProps) {
  const { state, requestTipSession, reset } = useTipSession(streamPubkey, streamId);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      reset();
      setQrDataUrl(null);
      return;
    }
    void requestTipSession();
  }, [open, requestTipSession, reset]);

  useEffect(() => {
    if (state.address) {
      QRCode.toDataURL(`monero:${state.address}`, {
        color: { dark: "#000000", light: "#ffffff" },
        margin: 2,
        scale: 6
      })
      .then(setQrDataUrl)
      .catch((err) => console.error("Failed to generate QR", err));
    } else {
      setQrDataUrl(null);
    }
  }, [state.address]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => onClose()} />
      <div className="relative z-10 w-full max-w-sm flex flex-col rounded-3xl border border-neutral-800 bg-neutral-950 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50">
          <div>
            <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
              <span className="text-orange-500">M</span> Send a Tip
            </h3>
            {broadcasterName && (
              <p className="text-xs text-neutral-400 mt-0.5">To {broadcasterName}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center justify-center min-h-[min(300px,50vh)]">
          {state.status === "requesting" && (
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
              <div className="text-sm text-neutral-400">Generating Monero Subaddress...</div>
            </div>
          )}

          {state.status === "error" && (
            <div className="text-center space-y-3">
              <div className="mx-auto w-10 h-10 rounded-full bg-red-950/50 flex items-center justify-center border border-red-500/20 text-red-500">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-400">{state.errorMessage}</p>
              <button 
                onClick={requestTipSession}
                className="px-4 py-2 mt-2 text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
              >
                Retry Request
              </button>
            </div>
          )}

          {state.status === "expired" && (
            <div className="text-center space-y-3">
              <div className="mx-auto w-10 h-10 rounded-full bg-amber-950/50 flex items-center justify-center border border-amber-500/20 text-amber-500">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-amber-400">Session expired. Generating a tip address is rate-limited to avoid spam.</p>
              <button 
                onClick={requestTipSession}
                className="px-4 py-2 mt-2 text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
              >
                Request New Address
              </button>
            </div>
          )}

          {(state.status === "pending" || state.status === "detected") && state.address && (
            <div className="flex flex-col items-center w-full max-w-[200px] animate-in fade-in zoom-in duration-300">
              {qrDataUrl && (
                <div className="relative p-2 bg-white rounded-xl shadow-[0_0_20px_rgba(249,115,22,0.1)] mb-4">
                  <img src={qrDataUrl} alt="Monero QR Code" className="w-full h-auto aspect-square" />
                  {state.status === "detected" && (
                    <div className="absolute inset-0 bg-green-500/20 backdrop-blur-[2px] rounded-xl flex items-center justify-center">
                      <div className="bg-neutral-900 border border-green-500/30 text-green-400 text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        Awaiting Confirmations...
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex flex-col items-center justify-center text-center space-y-1 mt-2">
                <p className="text-[10px] uppercase font-bold tracking-wider text-neutral-500">Deposit Address</p>
                <div 
                  className="font-mono text-[9px] text-neutral-400 break-all bg-neutral-900 p-2 rounded-lg border border-neutral-800 cursor-pointer hover:border-orange-500/50 hover:text-neutral-200 transition-colors w-full relative group"
                  onClick={() => {
                    navigator.clipboard.writeText(state.address!);
                    // Note: Could add a quick toast popup here natively if desired
                  }}
                  title="Click to copy address"
                >
                  {state.address}
                </div>
              </div>
            </div>
          )}

          {state.status === "confirmed" && (
            <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-500 delay-150">
              <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(52,211,153,0.3)] mb-4">
                <svg className="w-8 h-8 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-xl font-black text-white">Payment Received!</h4>
              {state.amountAtomic && (
                <p className="text-sm font-semibold text-green-400 mt-1">
                  {(parseInt(state.amountAtomic) / 1e12).toFixed(5)} XMR Verified
                </p>
              )}
              <p className="text-xs text-neutral-400 mt-2">The drop has been fully confirmed in the mempool.</p>
              <button 
                onClick={onClose}
                className="mt-6 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-sm font-bold text-white rounded-full transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
