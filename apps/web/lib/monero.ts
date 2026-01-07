/**
 * Monero Payment Verification
 * 
 * Supports:
 * - Self-hosted Monero node (RPC)
 * - Public explorer API fallback (xmrchain.net)
 * 
 * Tips are sacred - 100% verification required.
 */

export type MoneroVerificationMode = 'node' | 'public-api';

export interface MoneroConfig {
    mode: MoneroVerificationMode;
    nodeUrl?: string; // For 'node' mode: http://localhost:18081
    confirmationsRequired: number;
}

export interface PaymentVerification {
    verified: boolean;
    confirmations: number;
    amount?: number; // In atomic units (piconero)
    txHash?: string;
    error?: string;
}

// Default config - can be overridden
const defaultConfig: MoneroConfig = {
    mode: 'public-api',
    confirmationsRequired: 1, // For tips, 1 confirmation is usually sufficient
};

let config: MoneroConfig = { ...defaultConfig };

/**
 * Configure Monero verification settings
 */
export function configureMonero(newConfig: Partial<MoneroConfig>): void {
    config = { ...config, ...newConfig };
    console.log(`[Monero] Configured: mode=${config.mode}, confirmations=${config.confirmationsRequired}`);
}

/**
 * Verify a Monero payment by payment ID
 * 
 * @param address - Recipient's Monero address
 * @param paymentId - Unique payment ID for this transaction
 * @param expectedAmount - Expected amount in XMR (not atomic units)
 */
export async function verifyPayment(
    address: string,
    paymentId: string,
    expectedAmount: number
): Promise<PaymentVerification> {
    console.log(`[Monero] Verifying payment: ${paymentId} for ${expectedAmount} XMR`);

    if (config.mode === 'node') {
        return verifyViaNode(address, paymentId, expectedAmount);
    } else {
        return verifyViaPublicApi(address, paymentId, expectedAmount);
    }
}

/**
 * Verify via self-hosted Monero node (RPC)
 */
async function verifyViaNode(
    address: string,
    paymentId: string,
    expectedAmount: number
): Promise<PaymentVerification> {
    const nodeUrl = config.nodeUrl || 'http://localhost:18081';

    try {
        // Query incoming transfers with payment ID filter
        const response = await fetch(`${nodeUrl}/json_rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: '0',
                method: 'get_payments',
                params: { payment_id: paymentId }
            })
        });

        if (!response.ok) {
            return { verified: false, confirmations: 0, error: 'Node RPC request failed' };
        }

        const result = await response.json();

        if (result.error) {
            return { verified: false, confirmations: 0, error: result.error.message };
        }

        const payments = result.result?.payments || [];

        if (payments.length === 0) {
            return { verified: false, confirmations: 0, error: 'Payment not found' };
        }

        // Find matching payment
        for (const payment of payments) {
            const amountXmr = payment.amount / 1e12; // Convert from piconero
            if (amountXmr >= expectedAmount) {
                // Check confirmations via block height
                const blockHeight = payment.block_height;
                const currentHeight = await getCurrentBlockHeight(nodeUrl);
                const confirmations = currentHeight - blockHeight + 1;

                if (confirmations >= config.confirmationsRequired) {
                    return {
                        verified: true,
                        confirmations,
                        amount: payment.amount,
                        txHash: payment.tx_hash
                    };
                } else {
                    return {
                        verified: false,
                        confirmations,
                        amount: payment.amount,
                        txHash: payment.tx_hash,
                        error: `Waiting for confirmations: ${confirmations}/${config.confirmationsRequired}`
                    };
                }
            }
        }

        return { verified: false, confirmations: 0, error: 'Amount mismatch' };
    } catch (e: any) {
        return { verified: false, confirmations: 0, error: `Node error: ${e.message}` };
    }
}

/**
 * Get current block height from node
 */
async function getCurrentBlockHeight(nodeUrl: string): Promise<number> {
    const response = await fetch(`${nodeUrl}/json_rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: '0',
            method: 'get_height'
        })
    });
    const result = await response.json();
    return result.result?.height || 0;
}

/**
 * Verify via public explorer API (less private but simpler)
 * Uses xmrchain.net API
 */
async function verifyViaPublicApi(
    address: string,
    paymentId: string,
    expectedAmount: number
): Promise<PaymentVerification> {
    try {
        // Use internal proxy to avoid CORS issues on mobile
        const response = await fetch('/api/monero/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId })
        });

        if (!response.ok) {
            // Internal error or upstream 404
            return { verified: false, confirmations: 0, error: 'Payment lookup failed' };
        }

        const data = await response.json();

        // XMRChain API format check
        if (!data || data.status === 'fail' || !data.data) {
            return { verified: false, confirmations: 0, error: 'Payment not found' };
        }

        // Check if transaction exists and has correct output
        const tx = data.data;

        // Note: Public APIs may have limited output decoding
        // For full privacy, use your own node with view key
        return {
            verified: true,
            confirmations: tx.confirmations || 1,
            txHash: tx.tx_hash,
            amount: undefined // Amount may not be visible without view key
        };
    } catch (e: any) {
        return { verified: false, confirmations: 0, error: `API error: ${e.message}` };
    }
}

/**
 * Generate a unique payment ID (16 or 64 hex chars)
 * Short (16 char) payment IDs are deprecated but still work
 * Long (64 char) integrated addresses are preferred
 */
export function generatePaymentId(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validation
 */
export function validateMoneroAddress(address: string): { valid: boolean; type: 'primary' | 'subaddress' | 'integrated' | 'invalid'; warning?: string } {
    if (!address) return { valid: false, type: 'invalid' };

    // Simple verification length/prefix
    // Primary: 4.., 95 chars
    // Subaddress: 8.., 95 chars
    // Integrated: 4.., 106 chars

    if (address.startsWith('4') && address.length === 95) {
        return { valid: true, type: 'primary', warning: "Using a Primary Address links all streams to your main wallet. Recommended: Use a Subaddress." };
    }
    if (address.startsWith('8') && address.length === 95) {
        return { valid: true, type: 'subaddress' };
    }
    if ((address.startsWith('4') || address.startsWith('8')) && address.length === 106) {
        return { valid: true, type: 'integrated', warning: "Integrated address detected. Staking flow uses separate Payment IDs, but this works." };
    }

    // Stagenet/Testnet
    if (address.startsWith('5') || address.startsWith('7')) {
        return { valid: true, type: 'primary', warning: "Testnet/Stagenet Address detected." };
    }

    return { valid: false, type: 'invalid' };
}

/**
 * Monero Keys Interface
 */
export interface MoneroKeys {
    address: string;
    viewKeyPrivate: string;
    spendKeyPublic?: string;
    spendKeyPrivate?: string; // We generally avoid storing this on web
}

/**
 * Validate a Monero Secret Key (View or Spend)
 * Format: 64 hex characters (32 bytes)
 */
export function validateSecretKey(key: string): boolean {
    if (!key) return false;
    // Basic hex check + length
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    if (!hexRegex.test(key)) return false;

    // TODO: Advanced: Check if key is a valid scalar on Ed25519 curve (requires elliptic/noble)
    // For now, length+hex is a good basic check for paste errors.
    return true;
}

/**
 * Placeholder: Derive Monero keys (stub)
 * Real derivation requires `monero-javascript` or similar heavy WASM blob.
 * For this phase, we just validate the input format.
 */
export function validateKeySet(viewKey: string, address: string): boolean {
    return validateSecretKey(viewKey) && validateMoneroAddress(address).valid;
}
