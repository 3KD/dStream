import assert from "node:assert/strict";
import test from "node:test";

import {
  createVerifiedPreHydrationChatBootstrap,
  type PreHydrationChatBootstrap
} from "./chatBootstrap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createRawBootstrap() {
  let listener: { onevent: (event: unknown) => void; oneose: () => void } | null = null;
  let closed = 0;
  const bootstrap: PreHydrationChatBootstrap = {
    version: 1,
    streamPubkey: "a".repeat(64),
    streamId: "stream",
    attach(nextListener) {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    },
    close() {
      closed += 1;
    }
  };

  return {
    bootstrap,
    emitEvent(event: unknown) {
      listener?.onevent(event);
    },
    emitEose() {
      listener?.oneose();
    },
    get closed() {
      return closed;
    }
  };
}

test("pre-hydration chat events remain quarantined until verification completes", async () => {
  const raw = createRawBootstrap();
  const verification = deferred<boolean>();
  const bootstrap = createVerifiedPreHydrationChatBootstrap(
    { streamPubkey: raw.bootstrap.streamPubkey, streamId: raw.bootstrap.streamId },
    raw.bootstrap,
    () => verification.promise
  );
  const events: unknown[] = [];
  let eoseCount = 0;
  bootstrap.attach({
    onevent: (event) => events.push(event),
    oneose: () => {
      eoseCount += 1;
    }
  });

  const event = { id: "verified-event" };
  raw.emitEvent(event);
  raw.emitEose();
  await Promise.resolve();
  assert.deepEqual(events, []);
  assert.equal(eoseCount, 0);

  verification.resolve(true);
  await verification.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, [event]);
  assert.equal(eoseCount, 1);
});

test("pre-hydration chat drops invalid and duplicate events and closes its raw transport", async () => {
  const raw = createRawBootstrap();
  const bootstrap = createVerifiedPreHydrationChatBootstrap(
    { streamPubkey: raw.bootstrap.streamPubkey, streamId: raw.bootstrap.streamId },
    raw.bootstrap,
    async (event) => {
      if ((event as { throws?: boolean }).throws) throw new Error("verifier unavailable");
      return (event as { valid?: boolean }).valid === true;
    }
  );
  const events: unknown[] = [];
  const settled = deferred<void>();
  bootstrap.attach({ onevent: (event) => events.push(event), oneose: () => settled.resolve() });

  raw.emitEvent({ id: "throws", throws: true });
  raw.emitEvent({ id: "invalid", valid: false });
  raw.emitEvent({ id: "duplicate", valid: true, content: "first" });
  raw.emitEvent({ id: "duplicate", valid: true, content: "second" });
  raw.emitEose();
  await settled.promise;

  assert.deepEqual(events, [{ id: "duplicate", valid: true, content: "first" }]);
  bootstrap.close();
  bootstrap.close();
  assert.equal(raw.closed, 1);
});
