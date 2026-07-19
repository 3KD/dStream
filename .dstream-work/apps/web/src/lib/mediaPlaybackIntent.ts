const USER_PAUSED_DATASET_KEY = "dstreamUserPaused";

export function setMediaUserPaused(media: HTMLMediaElement | null, paused: boolean): void {
  if (!media) return;
  if (paused) {
    media.dataset[USER_PAUSED_DATASET_KEY] = "true";
    return;
  }
  delete media.dataset[USER_PAUSED_DATASET_KEY];
}

export function isMediaUserPaused(media: HTMLMediaElement): boolean {
  return media.dataset[USER_PAUSED_DATASET_KEY] === "true";
}
