import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetStableAudioForSource,
  prefersStableAudioForSource,
  rememberStableAudioForSource
} from "./sourceCompatibility";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("remembers a stable-audio preference without persisting URL credentials", () => {
  const storage = new MemoryStorage();
  const source = "https://api.zap.stream/stream/hls/live.m3u8?access=secret";
  const sameSourceWithAnotherToken = "https://api.zap.stream/stream/hls/live.m3u8?access=other";

  rememberStableAudioForSource(storage, source, 1_000);

  assert.equal(prefersStableAudioForSource(storage, sameSourceWithAnotherToken, 2_000), true);
  assert.doesNotMatch(storage.getItem("dstream_hls_source_compatibility_v1") ?? "", /secret|other/);
});

test("stable-audio preferences expire after their bounded lifetime", () => {
  const storage = new MemoryStorage();
  const source = "https://api.zap.stream/stream/hls/live.m3u8";

  rememberStableAudioForSource(storage, source, 1_000);

  assert.equal(prefersStableAudioForSource(storage, source, 1_000 + 5 * 60 * 60 * 1_000), true);
  assert.equal(prefersStableAudioForSource(storage, source, 1_000 + 7 * 60 * 60 * 1_000), false);
});

test("trying source video clears the remembered audio preference", () => {
  const storage = new MemoryStorage();
  const source = "https://api.zap.stream/stream/hls/live.m3u8";

  rememberStableAudioForSource(storage, source, 1_000);
  forgetStableAudioForSource(storage, source);

  assert.equal(prefersStableAudioForSource(storage, source, 2_000), false);
});
