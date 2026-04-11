"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export type TipSessionStatus = "idle" | "requesting" | "pending" | "detected" | "confirmed" | "error" | "expired";

export interface TipSessionState {
  status: TipSessionStatus;
  address: string | null;
  sessionToken: string | null;
  amountAtomic: string | null;
  errorMessage: string | null;
}

const POLLING_INTERVAL_MS = 5000;
const SESSION_MAX_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes

export function useTipSession(streamPubkey: string, streamId: string) {
  const [state, setState] = useState<TipSessionState>({
    status: "idle",
    address: null,
    sessionToken: null,
    amountAtomic: null,
    errorMessage: null,
  });

  const sessionStartMsRef = useRef<number>(0);
  const pollingTimerRef = useRef<number | NodeJS.Timeout | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current as number);
      pollingTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async (token: string) => {
    if (Date.now() - sessionStartMsRef.current > SESSION_MAX_LIFETIME_MS) {
      clearPolling();
      setState((s) => ({ ...s, status: "expired" }));
      return;
    }

    try {
      const res = await fetch(`/api/xmr/tip/session/${encodeURIComponent(token)}`);
      
      if (!res.ok) {
        if (res.status === 410) {
          clearPolling();
          setState((s) => ({ ...s, status: "expired" }));
        }
        return; 
      }

      const data = await res.json();
      if (data.found && data.confirmed) {
        clearPolling();
        setState((s) => ({ 
          ...s, 
          status: "confirmed", 
          amountAtomic: data.amountAtomic
        }));
      } else if (data.found && !data.confirmed) {
        // Tip detected in mempool but waiting for confirmations
        setState((s) => ({ 
          ...s, 
          status: "detected",
          amountAtomic: data.amountAtomic
        }));
      }
    } catch (err) {
      // transient network errors ignored during polling
    }
  }, [clearPolling]);

  const requestTipSession = useCallback(async () => {
    setState({
      status: "requesting",
      address: null,
      sessionToken: null,
      amountAtomic: null,
      errorMessage: null,
    });
    clearPolling();

    try {
      const res = await fetch("/api/xmr/tip/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamPubkey, streamId }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      setState((s) => ({
        ...s,
        status: "pending",
        address: data.address,
        sessionToken: data.session,
      }));

      sessionStartMsRef.current = Date.now();
      pollingTimerRef.current = setInterval(() => void pollStatus(data.session), POLLING_INTERVAL_MS);
    } catch (err: any) {
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: err.message || "Failed to initiate tip session",
      }));
    }
  }, [streamPubkey, streamId, clearPolling, pollStatus]);

  const reset = useCallback(() => {
    clearPolling();
    setState({
      status: "idle",
      address: null,
      sessionToken: null,
      amountAtomic: null,
      errorMessage: null,
    });
  }, [clearPolling]);

  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  return {
    state,
    requestTipSession,
    reset,
  };
}
