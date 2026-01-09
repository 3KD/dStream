
import { verifyNip05 } from '../lib/nip05';

const mockFetch = (responseBody: any, ok = true) => {
    return Promise.resolve({
        ok,
        status: ok ? 200 : 404,
        json: () => Promise.resolve(responseBody)
    } as Response);
};

async function runTests() {
    console.log("Starting NIP-05 Tests...");

    const expectedPubkey = "a1b2c3d4e5f6";

    // Test 1: Valid User
    console.log("\nTest 1: Valid Verification");
    global.fetch = (() => mockFetch({
        names: { "alice": "a1b2c3d4e5f6" }
    })) as any;

    const res1 = await verifyNip05("alice@example.com", expectedPubkey);
    if (res1.valid && res1.name === "alice" && res1.domain === "example.com") {
        console.log("✅ PASS: Valid user verified");
    } else {
        console.error("❌ FAIL: Valid user failed", res1);
        process.exit(1);
    }

    // Test 2: User Invalid (Mismatch)
    console.log("\nTest 2: Pubkey Mismatch");
    global.fetch = (() => mockFetch({
        names: { "alice": "wrongpubkey" }
    })) as any;

    const res2 = await verifyNip05("alice@example.com", expectedPubkey);
    if (!res2.valid && res2.error && res2.error.toLowerCase().includes("mismatch")) {
        console.log("✅ PASS: Mismatch detected");
    } else {
        console.error("❌ FAIL: Mismatch not detected", res2);
        process.exit(1);
    }

    // Test 3: User Not Found
    console.log("\nTest 3: User Not Found");
    global.fetch = (() => mockFetch({
        names: { "bob": "somekey" }
    })) as any;

    const res3 = await verifyNip05("alice@example.com", expectedPubkey);
    if (!res3.valid && res3.error && res3.error.includes("not found")) {
        console.log("✅ PASS: User not found handled");
    } else {
        console.error("❌ FAIL: User not found handling", res3);
        process.exit(1);
    }

    console.log("\nTests Complete.");
}

runTests();
