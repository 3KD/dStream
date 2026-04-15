"use client";

import { useState } from "react";
import { TipDialog as MoneroTipDialog } from "@/components/monero/TipDialog";
import { useNostrProfile } from "@/hooks/useNostrProfiles";

interface UnifiedTipDialogProps {
  open: boolean;
  streamPubkey: string;
  streamId: string;
  broadcasterName?: string;
  onClose: () => void;
}

export function UnifiedTipDialog({ open, streamPubkey, streamId, broadcasterName, onClose }: UnifiedTipDialogProps) {
  const profileRecord = useNostrProfile(streamPubkey);
  const profile = profileRecord?.profile;
  const lud16 = profile?.lud16 || profile?.lud06;
  const btc = profile?.btc;
  const eth = profile?.eth;
  const trx = profile?.trx;
  const xmr = profile?.xmr;
  const sol = profile?.sol;
  const ada = profile?.ada;
  const doge = profile?.doge;
  const ltc = profile?.ltc;
  const ton = profile?.ton;
  const xrp = profile?.xrp;
  const dot = profile?.dot;
  
  const hasAnyAddress = !!(lud16 || btc || eth || trx || xmr || sol || ada || doge || ltc || ton || xrp || dot);

  const [showMonero, setShowMonero] = useState(false);

  if (showMonero) {
    return (
      <MoneroTipDialog
        open={open}
        streamPubkey={streamPubkey}
        streamId={streamId}
        broadcasterName={broadcasterName}
        onClose={() => {
          setShowMonero(false);
          onClose();
        }}
      />
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm flex flex-col rounded-3xl border border-neutral-800 bg-neutral-950 shadow-2xl overflow-hidden max-h-[85vh]">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
              <span className="text-yellow-500">💎</span> Support Creator
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
        <div className="p-6 flex flex-col items-center flex-1 overflow-y-auto space-y-6">
          
          {hasAnyAddress ? (
            <div className="flex flex-col items-center text-center w-full space-y-4">
              
              {lud16 && (
                <div className="w-full bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-yellow-500/10 flex items-center justify-center text-yellow-500">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-bold text-white">Lightning Zap</h4>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <a 
                      href={`lightning:${lud16}`}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-yellow-950 font-bold rounded-xl transition-colors text-sm"
                    >
                      Open Wallet Extension
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(lud16)}
                      className="w-full py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-300 font-mono rounded-xl text-xs transition-colors truncate px-3"
                      title="Copy Address"
                    >
                      {lud16}
                    </button>
                  </div>
                </div>
              )}

              {btc && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-orange-500 ml-1">Bitcoin (BTC)</span>
                  <button onClick={() => navigator.clipboard.writeText(btc)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-orange-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{btc}</button>
                </div>
              )}

              {eth && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400 ml-1">EVM Wrapper (Ethereum, BNB, MATIC, Base)</span>
                  <button onClick={() => navigator.clipboard.writeText(eth)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-purple-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{eth}</button>
                </div>
              )}

              {sol && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 ml-1">Solana (SOL)</span>
                  <button onClick={() => navigator.clipboard.writeText(sol)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-emerald-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{sol}</button>
                </div>
              )}

              {doge && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-amber-500 ml-1">Dogecoin (DOGE)</span>
                  <button onClick={() => navigator.clipboard.writeText(doge)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-amber-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{doge}</button>
                </div>
              )}

              {ltc && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-stone-300 ml-1">Litecoin (LTC)</span>
                  <button onClick={() => navigator.clipboard.writeText(ltc)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-stone-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{ltc}</button>
                </div>
              )}
              
              {ton && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-500 ml-1">Toncoin (TON)</span>
                  <button onClick={() => navigator.clipboard.writeText(ton)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-blue-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{ton}</button>
                </div>
              )}

              {ada && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400 ml-1">Cardano (ADA)</span>
                  <button onClick={() => navigator.clipboard.writeText(ada)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-cyan-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{ada}</button>
                </div>
              )}

              {xrp && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 ml-1">Ripple (XRP)</span>
                  <button onClick={() => navigator.clipboard.writeText(xrp)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-slate-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{xrp}</button>
                </div>
              )}

              {dot && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-pink-500 ml-1">Polkadot (DOT)</span>
                  <button onClick={() => navigator.clipboard.writeText(dot)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-pink-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{dot}</button>
                </div>
              )}

              {trx && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-red-500 ml-1">TRON (TRX)</span>
                  <button onClick={() => navigator.clipboard.writeText(trx)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-red-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{trx}</button>
                </div>
              )}

              {xmr && (
                <div className="w-full flex flex-col items-start gap-1 p-3 border border-neutral-800 rounded-xl bg-neutral-900/30">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-orange-500 ml-1">Monero (XMR) Native</span>
                  <button onClick={() => navigator.clipboard.writeText(xmr)} className="w-full text-left py-1.5 px-2 bg-black/50 border border-neutral-800 hover:border-orange-500/50 text-neutral-400 hover:text-neutral-200 font-mono rounded-lg text-xs truncate transition-colors">{xmr}</button>
                </div>
              )}

            </div>
          ) : (
            <div className="flex flex-col items-center text-center w-full text-neutral-500 py-4">
              <svg className="w-10 h-10 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">This creator does not have any public wallet addresses configured on their Nostr profile.</p>
            </div>
          )}

          <div className="w-full h-px bg-neutral-800/60" />

          <div className="flex flex-col items-center text-center w-full pb-2">
            <p className="text-xs text-neutral-500 mb-3 max-w-[260px]">
              Or generate a temporary dStream escrow address for absolute privacy.
            </p>
            <button
              onClick={() => setShowMonero(true)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold rounded-full text-xs flex items-center gap-2 border border-neutral-700 transition-colors"
            >
              <span className="text-orange-500 font-black">XMR</span> Private Proxy
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
