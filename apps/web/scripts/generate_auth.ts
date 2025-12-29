
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

// Minimal implementation of deriveStreamPath to avoid importing from app code
async function deriveStreamPath(pubkey: string, name: string): Promise<string> {
    const input = pubkey + name;
    // We need SHA256 of utf-8 string
    const msg = new TextEncoder().encode(input);
    const hash = sha256(msg);
    const hashHex = ed.etc.bytesToHex(hash);
    return hashHex.substring(0, 16);
}

async function main() {
    // Generate random identity
    const privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const pubKeyHex = ed.etc.bytesToHex(pubKey);

    const streamName = "test";
    const streamPath = await deriveStreamPath(pubKeyHex, streamName);

    // Sign the streamPath
    const msg = new TextEncoder().encode(streamPath);
    const sig = await ed.signAsync(msg, privKey);
    const sigHex = ed.etc.bytesToHex(sig);

    console.log(`rtmp://mediamtx:1940/${streamPath}?pubkey=${pubKeyHex}&sig=${sigHex}&name=${streamName}`);
}

main();
