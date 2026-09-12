import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStartupAudioPreference } from "./playbackAudio";

test("startup audio: mobile autoplay starts muted but remembers an audible preference", () => {
  assert.deepEqual(
    resolveStartupAudioPreference({
      persisted: { muted: false, volume: 0.42 },
      autoplayMuted: true,
      backgroundPlayEnabled: false
    }),
    { muted: true, volume: 0, rememberedAudibleVolume: 0.42 }
  );
});

test("startup audio: background mode restores a saved audible preference", () => {
  assert.deepEqual(
    resolveStartupAudioPreference({
      persisted: { muted: false, volume: 0.42 },
      autoplayMuted: false,
      backgroundPlayEnabled: true
    }),
    { muted: false, volume: 0.42, rememberedAudibleVolume: 0.42 }
  );
});

test("startup audio: background mode preserves an explicit saved mute", () => {
  assert.deepEqual(
    resolveStartupAudioPreference({
      persisted: { muted: true, volume: 0.8 },
      autoplayMuted: false,
      backgroundPlayEnabled: true
    }),
    { muted: true, volume: 0, rememberedAudibleVolume: null }
  );
});

test("startup audio: background mode defaults to audible playback", () => {
  assert.deepEqual(
    resolveStartupAudioPreference({
      persisted: null,
      autoplayMuted: false,
      backgroundPlayEnabled: true
    }),
    { muted: false, volume: 1, rememberedAudibleVolume: 1 }
  );
});

test("startup audio: inconsistent zero-volume state is treated as muted", () => {
  assert.deepEqual(
    resolveStartupAudioPreference({
      persisted: { muted: false, volume: 0 },
      autoplayMuted: false,
      backgroundPlayEnabled: true
    }),
    { muted: true, volume: 0, rememberedAudibleVolume: null }
  );
});
