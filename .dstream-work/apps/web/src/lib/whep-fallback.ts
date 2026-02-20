export type PlaybackMode = "whep" | "hls";

export async function pickPlaybackMode(opts: {
  whepSrc: string | null | undefined;
  rtcSupported: boolean;
  preferLowLatency: boolean;
  tryWhep: () => Promise<boolean>;
}): Promise<{ mode: PlaybackMode; attemptedWhep: boolean }> {
  const endpoint = (opts.whepSrc ?? "").trim();
  if (!endpoint || !opts.rtcSupported || !opts.preferLowLatency) return { mode: "hls", attemptedWhep: false };
  const ok = await opts.tryWhep();
  return { mode: ok ? "whep" : "hls", attemptedWhep: true };
}
