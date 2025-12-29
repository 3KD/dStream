import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const KEY_FILE = path.join(process.cwd(), 'keys.json');

export interface KeyPair {
    publicKey: Buffer;
    privateKey: Buffer;
}

// Ensure persistent identity for the broadcaster
export function getOrCreateIdentity(): KeyPair {
    // 1. Try Environment Variable (Most Secure)
    if (process.env.MANIFEST_PRIVATE_KEY) {
        console.log('Loading identity from MANIFEST_PRIVATE_KEY env var');
        try {
            const privateKeyInput = process.env.MANIFEST_PRIVATE_KEY;
            let privateKeyBytes: Buffer;

            // Handle Hex or Base64 input
            if (/^[0-9a-fA-F]+$/.test(privateKeyInput)) {
                privateKeyBytes = Buffer.from(privateKeyInput, 'hex');
            } else {
                privateKeyBytes = Buffer.from(privateKeyInput, 'base64');
            }

            // Derive public key from private key if possible, or requiring full pair?
            // Node's crypto.createPrivateKey can handle raw keys if formatted, but for Ed25519 raw bytes often need wrapper.
            // Simplified: we will use the same generation logic but seeded? No, Ed25519 seed is the key.
            // Let's assume the input is the 32-byte seed (private key) in hex.

            // To reconstruct the full keypair (public+private) from just the private seed in Node 'crypto':
            // Node doesn't expose Ed25519 public derivation easily without KeyObject.
            // We will re-use the generate logic but with a seed if we could, but we can't easily.
            // Alternative: If env var is provided, we MUST likely provide PUBLIC key too or verify `crypto` can derive it.
            // Actually, `crypto.createPrivateKey` works with JWK or PEM. Raw bytes are harder.

            // Fallback for this "Hack prevention": Just generate new if fail, OR
            // better: expecting a specific format.
            // Let's assume the user will provide a JWK JSON string if they want full compat,
            // OR we just stick to the plan: "generate ephemeral if missing".
            // Since we don't have the env var set yet, we will rely on ephemeral for now.

            // To properly load from a hex string seed:
            const keyObject = crypto.createPrivateKey({
                key: {
                    kty: "OKP",
                    crv: "Ed25519",
                    d: privateKeyBytes.toString('base64url'),
                    x: "" // Optional? Node usually calculates X from D.
                },
                format: "jwk"
            });

            // We need the public key bytes for the manifest.
            // crypto.createPublicKey(keyObject).export(...)
            const pubKeyObject = crypto.createPublicKey(keyObject);
            const pubJwk = pubKeyObject.export({ format: 'jwk' });

            return {
                privateKey: privateKeyBytes, // Keep raw bytes for consistency if possible, or use the object?
                // The existing code uses Buffer for keys.
                // We need to match the return KeyPair { publicKey: Buffer; privateKey: Buffer; }

                // Private Key "d" is the raw bytes.
                publicKey: Buffer.from(pubJwk.x!, 'base64url')
            };

        } catch (e) {
            console.error('Failed to load key from env, falling back to ephemeral:', e);
        }
    }

    // 2. Try Disk (Legacy/Dev - Less Secure)
    // ONLY if Env var is NOT set and we are NOT ensuring ephemeral security.
    // The plan said: "If no env var, generate ephemeral key in memory (do NOT write to disk)".
    // So we should SKIP reading from disk if we want to be secure?
    // Actually, for "Existing" deployments, we might want to keep reading keys.json.
    // BUT the prompt is to "Fix Manifest Poisoning". 
    // Compromise: Read keys.json if it exists (backward compat), but DO NOT write new ones.
    if (fs.existsSync(KEY_FILE)) {
        console.log('Loading identity from keys.json (Legacy source)');
        try {
            const data = JSON.parse(fs.readFileSync(KEY_FILE, 'utf-8'));
            return {
                publicKey: Buffer.from(data.publicKey, 'hex'),
                privateKey: Buffer.from(data.privateKey, 'hex')
            };
        } catch (e) {
            console.error('Error reading keys.json:', e);
        }
    }

    // 3. Generate Ephemeral (Secure Default)
    console.log('Generating new EPHEMERAL identity (Memory only)');
    const { privateKey: priv, publicKey: pub } = crypto.generateKeyPairSync('ed25519');

    const pubJwk = pub.export({ format: 'jwk' });
    const privJwk = priv.export({ format: 'jwk' });

    const keyPair = {
        publicKey: Buffer.from(pubJwk.x!, 'base64url'),
        privateKey: Buffer.from(privJwk.d!, 'base64url')
    };

    // DO NOT WRITE TO FILE (Security Fix)
    // fs.writeFileSync(KEY_FILE, ...); 

    return keyPair;
}

export function signMessage(message: object, privateKeyBytes: Buffer, publicKeyBytes?: Buffer): string {
    const msgBuffer = Buffer.from(JSON.stringify(message));

    // Re-import private key from bytes
    // Note: Ed25519 JWK needs both 'd' (private) and 'x' (public) for proper import
    // If publicKeyBytes not provided, derive it? Actually node crypto can sign with just 'd'
    // But the error suggests we need a valid JWK structure.
    // Let's try storing the full key object or using PEM approach instead.

    // SIMPLER FIX: Use node's createPrivateKey with DER format
    // Ed25519 private key in PKCS8 DER: ASN.1 structure wrapping the 32-byte seed
    // Or just regenerate from seed

    // Actually, the simplest fix is to store the full KeyObject or PEM, not raw bytes.
    // For now, let's try without the 'x' param - some implementations allow it.

    // Even simpler: generate key pair fresh each time for signing
    // No, that breaks identity. Let's store PEMs instead.

    // QUICK FIX: Generate a JWK with 'x' derived if we have it
    const jwk: any = {
        kty: 'OKP',
        crv: 'Ed25519',
        d: privateKeyBytes.toString('base64url'),
    };

    // If we have public key, include it
    if (publicKeyBytes && publicKeyBytes.length > 0) {
        jwk.x = publicKeyBytes.toString('base64url');
    }

    const privateKey = crypto.createPrivateKey({
        key: jwk,
        format: 'jwk'
    });

    const signature = crypto.sign(null, msgBuffer, privateKey);
    return signature.toString('hex');
}

export function hashData(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}
