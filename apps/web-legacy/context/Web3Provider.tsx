"use client";

import React, { type ReactNode } from "react";

/**
 * Minimal Web3Provider that acts as a passthrough.
 * The full wagmi/reown integration is temporarily disabled due to 
 * module resolution issues with @wagmi/connectors optional dependencies.
 * 
 * ETH tipping will be re-enabled when these issues are resolved.
 */
export function Web3Provider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

// Export placeholder hooks for components
export function useWeb3() {
    return {
        isConnected: false,
        address: null,
        connect: () => console.warn("Web3 temporarily disabled due to dependency issues"),
        disconnect: () => { },
    };
}
