const BACKGROUND_PLAY_PREF_KEY = "dstream_player_background_play_v1";
const BACKGROUND_PLAY_EVENT = "dstream:background-playback-change";

export function readBackgroundPlayPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(BACKGROUND_PLAY_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBackgroundPlayPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const value = enabled ? "1" : "0";
    const changed = localStorage.getItem(BACKGROUND_PLAY_PREF_KEY) !== value;
    localStorage.setItem(BACKGROUND_PLAY_PREF_KEY, value);
    if (changed) window.dispatchEvent(new CustomEvent<boolean>(BACKGROUND_PLAY_EVENT, { detail: enabled }));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

export function subscribeBackgroundPlayPreference(listener: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onLocalChange = (event: Event) => {
    listener((event as CustomEvent<boolean>).detail === true);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === BACKGROUND_PLAY_PREF_KEY) listener(event.newValue === "1");
  };
  window.addEventListener(BACKGROUND_PLAY_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BACKGROUND_PLAY_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
}
