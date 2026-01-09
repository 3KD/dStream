
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { encryptSignal, decryptSignal, P2PSignal } from '../lib/p2p';
import { Identity } from '../lib/identity';

function bytesToHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex');
}

async function runTests() {
    console.log("Starting P2P Tests...");

    // Setup Alice
    const alicePriv = generateSecretKey();
    const alicePub = getPublicKey(alicePriv);
    // Convert Uint8Array private key to hex for Identity interface if needed, 
    // or keep as Uint8Array if nip04 accepts it. 
    // nip04.encrypt in nostr-tools v2 accepts hex string or Uint8Array? 
    // Let's check imports. Apps usually use hex strings.
    // The lib/identity.ts likely expects hex strings.
    const aliceIdentity: Identity = {
        nostrPrivateKey: bytesToHex(alicePriv),
        nostrPublicKey: alicePub,
        // Mock other fields
        ephemeralPrivateKey: "",
        ephemeralPublicKey: "",
        moneroPrivateViewKey: "",
        moneroPublicViewKey: "",
        moneroPrimaryAddress: "",
    };

    // Setup Bob
    const bobPriv = generateSecretKey();
    const bobPub = getPublicKey(bobPriv);
    const bobIdentity: Identity = {
        nostrPrivateKey: bytesToHex(bobPriv),
        nostrPublicKey: bobPub,
        ephemeralPrivateKey: "",
        ephemeralPublicKey: "",
        moneroPrivateViewKey: "",
        moneroPublicViewKey: "",
        moneroPrimaryAddress: "",
    };

    console.log(`Alice: ${alicePub}`);
    console.log(`Bob: ${bobPub}`);

    // Test 1: Alice sends Offer to Bob
    console.log("\nTest 1: Alice sends Offer to Bob");
    const offerSignal: P2PSignal = {
        type: 'offer',
        sdp: 'v=0\r\no=alice 12345 67890 IN IP4 0.0.0.0\r\n...'
    };

    try {
        const encrypted = await encryptSignal(aliceIdentity, bobPub, offerSignal);
        console.log("Encrypted:", encrypted.substring(0, 20) + "...");

        const decrypted = await decryptSignal(bobIdentity, alicePub, encrypted);
        console.log("Decrypted:", decrypted);

        if (decrypted && decrypted.type === 'offer' && decrypted.sdp === offerSignal.sdp) {
            console.log("✅ PASS: Offer decrypted correctly");
        } else {
            console.error("❌ FAIL: Decrypted signal mismatch");
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ FAIL: Encryption/Decryption error", e);
        process.exit(1);
    }

    console.log("\nTests Complete.");
}

runTests();
