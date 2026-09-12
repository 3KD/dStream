export interface PersistedPlaybackAudioState {
  volume?: number;
  muted?: boolean;
}

export interface StartupAudioPreference {
  muted: boolean;
  volume: number;
  rememberedAudibleVolume: number | null;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

export function resolveStartupAudioPreference(input: {
  persisted: PersistedPlaybackAudioState | null;
  autoplayMuted: boolean;
  backgroundPlayEnabled: boolean;
}): StartupAudioPreference {
  const { persisted, autoplayMuted, backgroundPlayEnabled } = input;
  const persistedVolume = clampVolume(typeof persisted?.volume === "number" ? persisted.volume : 1);
  const persistedMuted = persisted?.muted === true || (persisted !== null && persistedVolume <= 0);
  const rememberedAudibleVolume = !persistedMuted && persistedVolume > 0 ? persistedVolume : null;

  if (!backgroundPlayEnabled && autoplayMuted) {
    return { muted: true, volume: 0, rememberedAudibleVolume };
  }

  if (persisted) {
    if (persistedMuted) return { muted: true, volume: 0, rememberedAudibleVolume: null };
    return {
      muted: false,
      volume: backgroundPlayEnabled ? Math.max(0.05, persistedVolume) : persistedVolume,
      rememberedAudibleVolume
    };
  }

  return { muted: false, volume: 1, rememberedAudibleVolume: 1 };
}
