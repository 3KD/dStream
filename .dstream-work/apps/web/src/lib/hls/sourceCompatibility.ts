const STORAGE_KEY = "dstream_hls_source_compatibility_v1";
const AUDIO_PREFERENCE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_ENTRIES = 32;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredPreference = {
  mode: "audio";
  expiresAtMs: number;
};

type StoredPreferences = {
  version: 1;
  entries: Record<string, StoredPreference>;
};

function sourceKey(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function readPreferences(storage: StorageLike): StoredPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPreferences> | null;
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return { version: 1, entries: parsed.entries as Record<string, StoredPreference> };
  } catch {
    return { version: 1, entries: {} };
  }
}

function writePreferences(storage: StorageLike, preferences: StoredPreferences): void {
  try {
    const entries = Object.fromEntries(
      Object.entries(preferences.entries)
        .sort((left, right) => right[1].expiresAtMs - left[1].expiresAtMs)
        .slice(0, MAX_ENTRIES)
    );
    if (Object.keys(entries).length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
  } catch {
    // Storage is an optional optimization.
  }
}

export function prefersStableAudioForSource(storage: StorageLike, sourceUrl: string, nowMs = Date.now()): boolean {
  const key = sourceKey(sourceUrl);
  if (!key) return false;
  const preferences = readPreferences(storage);
  const preference = preferences.entries[key];
  if (!preference || preference.mode !== "audio") return false;
  if (!Number.isFinite(preference.expiresAtMs) || preference.expiresAtMs <= nowMs) {
    delete preferences.entries[key];
    writePreferences(storage, preferences);
    return false;
  }
  return true;
}

export function rememberStableAudioForSource(storage: StorageLike, sourceUrl: string, nowMs = Date.now()): void {
  const key = sourceKey(sourceUrl);
  if (!key) return;
  const preferences = readPreferences(storage);
  preferences.entries[key] = {
    mode: "audio",
    expiresAtMs: nowMs + AUDIO_PREFERENCE_TTL_MS
  };
  writePreferences(storage, preferences);
}

export function forgetStableAudioForSource(storage: StorageLike, sourceUrl: string): void {
  const key = sourceKey(sourceUrl);
  if (!key) return;
  const preferences = readPreferences(storage);
  if (!preferences.entries[key]) return;
  delete preferences.entries[key];
  writePreferences(storage, preferences);
}
