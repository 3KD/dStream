/**
 * Monero Utilities
 * 
 * Tier 23: Basic Monero address handling.
 * Full RPC integration requires monerod running.
 */

/**
 * Validate a Monero address format.
 * Basic check - does not verify checksum.
 */
export function isValidMoneroAddress(address: string): boolean {
    // Main address starts with 4, subaddress starts with 8
    if (!address) return false;
    if (!/^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(address)) {
        // Check for integrated address (106 chars)
        if (!/^4[1-9A-HJ-NP-Za-km-z]{104}$/.test(address)) {
            return false;
        }
    }
    return true;
}

/**
 * Generate a payment ID (16 hex chars).
 */
export function generatePaymentId(): string {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shorten address for display.
 */
export function shortenAddress(address: string): string {
    if (address.length < 20) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

// Note: Full subaddress generation requires wallet RPC.
// These are stubs for the payment flow.

export interface PaymentRequest {
    address: string;
    amount: number; // in atomic units (piconero)
    paymentId?: string;
    memo?: string;
}

export function createPaymentUri(request: PaymentRequest): string {
    const { address, amount, paymentId, memo } = request;
    let uri = `monero:${address}?tx_amount=${amount}`;
    if (paymentId) uri += `&tx_payment_id=${paymentId}`;
    if (memo) uri += `&tx_description=${encodeURIComponent(memo)}`;
    return uri;
}
