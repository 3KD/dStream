/**
 * NIP-05 Identity Verification
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/05.md
 * 
 * Verifies that a user's pubkey is linked to a specific domain.
 */

export interface Nip05Result {
    valid: boolean;
    error?: string;
    domain?: string;
    name?: string;
}

/**
 * Verify a NIP-05 address for a given public key
 * Format: name@domain.com
 */
export async function verifyNip05(address: string, expectedPubkey: string): Promise<Nip05Result> {
    if (!address || !address.includes('@')) {
        return { valid: false, error: "Invalid address format. Use name@domain.com" };
    }

    const [name, domain] = address.split('@');
    if (!name || !domain) {
        return { valid: false, error: "Invalid address format." };
    }

    try {
        // Use a CORS proxy if necessary, but browsers should allow this if the domain has correct headers
        // Most Nostr-friendly domains serve this with Access-Control-Allow-Origin: *
        const url = `https://${domain}/.well-known/nostr.json?name=${name}`;

        const response = await fetch(url, {
            mode: 'cors',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            return {
                valid: false,
                error: `Could not reach domain. HTTP ${response.status}`,
                domain,
                name
            };
        }

        const data = await response.json();

        if (!data.names || !data.names[name]) {
            return {
                valid: false,
                error: `User '${name}' not found on this domain.`,
                domain,
                name
            };
        }

        const publishedPubkey = data.names[name];

        if (publishedPubkey === expectedPubkey) {
            return { valid: true, domain, name };
        } else {
            return {
                valid: false,
                error: "Pubkey mismatch. Domain points to a different user.",
                domain,
                name
            };
        }

    } catch (e: any) {
        console.error("[NIP-05] Verification failed:", e);
        return {
            valid: false,
            error: "Network error or domain doesn't support NIP-05.",
            domain,
            name
        };
    }
}
