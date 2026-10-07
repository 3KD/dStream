import { validateEvent, verifiedSymbol, type Event as NostrEvent, type VerifiedEvent } from "nostr-tools/core";

export interface NostrWasmRuntime {
  generateSecretKey: () => Uint8Array;
  getPublicKey: (secretKey: Uint8Array) => Uint8Array;
  finalizeEvent: (event: Record<string, unknown>, secretKey: Uint8Array) => void;
  verifyEvent: (event: NostrEvent) => void;
}

type DStreamNostrWasmGlobal = typeof globalThis & {
  __dstreamNostrWasmPromise?: Promise<NostrWasmRuntime>;
};

const nostrWasmGlobal = globalThis as DStreamNostrWasmGlobal;

export function loadNostrWasm(): Promise<NostrWasmRuntime> {
  if (nostrWasmGlobal.__dstreamNostrWasmPromise) {
    return nostrWasmGlobal.__dstreamNostrWasmPromise;
  }

  const pending = (typeof window === "undefined"
    ? import("nostr-wasm").then(async ({ initNostrWasm }) => (await initNostrWasm()) as NostrWasmRuntime)
    : (async () => {
        const wasmResponse = await fetch("/nostr/secp256k1.wasm", { cache: "force-cache" });
        if (!wasmResponse.ok) {
          throw new Error(`Failed to load Nostr verifier (${wasmResponse.status}).`);
        }
        const fallbackResponse = wasmResponse.clone();
        // nostr-wasm 0.1.0 publishes this runtime wrapper but omits its documented headless export file.
        // @ts-expect-error The bundled runtime module has no standalone declaration file.
        const { N: createRuntime } = (await import("../../../../node_modules/nostr-wasm/dist/nostr.js")) as {
          N: (source: Promise<Response> | BufferSource) => Promise<NostrWasmRuntime>;
        };
        try {
          return await createRuntime(Promise.resolve(wasmResponse));
        } catch {
          return await createRuntime(await fallbackResponse.arrayBuffer());
        }
      })())
    .catch((error) => {
      delete nostrWasmGlobal.__dstreamNostrWasmPromise;
      throw error;
    });

  nostrWasmGlobal.__dstreamNostrWasmPromise = pending;
  return pending;
}

export function createNostrWasmVerifier(runtime: NostrWasmRuntime): (event: NostrEvent) => event is VerifiedEvent {
  return (event): event is VerifiedEvent => {
    if (!validateEvent(event)) return false;
    if (!/^[a-f0-9]{64}$/.test(event.id) || !/^[a-f0-9]{128}$/.test(event.sig)) return false;

    try {
      runtime.verifyEvent(event);
      event[verifiedSymbol] = true;
      return true;
    } catch {
      event[verifiedSymbol] = false;
      return false;
    }
  };
}

export async function verifyNostrEvent(event: unknown): Promise<boolean> {
  const runtime = await loadNostrWasm();
  return createNostrWasmVerifier(runtime)(event as NostrEvent);
}
