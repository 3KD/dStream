import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
  PlaylistLoaderContext
} from "hls.js";

export type PlaylistWindow = {
  mediaSequence: number;
  endSequence: number;
  lastProgramDateTime: number | null;
};

const windowsByConfig = new WeakMap<object, Map<string, PlaylistWindow>>();
const STALE_RETRY_LIMIT = 3;

function emptyStats(): LoaderStats {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: now, first: now, end: now },
    parsing: { start: now, end: now },
    buffering: { start: now, first: now, end: now }
  };
}

export function inspectPlaylistWindow(playlist: string): PlaylistWindow | null {
  const sequenceMatch = playlist.match(/^#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)\s*$/m);
  if (!sequenceMatch) return null;
  const mediaSequence = Number(sequenceMatch[1]);
  if (!Number.isSafeInteger(mediaSequence) || mediaSequence < 0) return null;

  const skippedMatch = playlist.match(/^#EXT-X-SKIP\s*:.*\bSKIPPED-SEGMENTS=(\d+)/m);
  const skippedSegments = skippedMatch ? Number(skippedMatch[1]) : 0;
  const completeSegments = playlist.match(/^#EXTINF\s*:/gm)?.length ?? 0;
  const endSequence = mediaSequence + skippedSegments + Math.max(0, completeSegments - 1);
  const programDates = Array.from(playlist.matchAll(/^#EXT-X-PROGRAM-DATE-TIME\s*:\s*(.+)\s*$/gm))
    .map((match) => Date.parse(match[1] ?? ""))
    .filter(Number.isFinite);

  return {
    mediaSequence,
    endSequence,
    lastProgramDateTime: programDates.length > 0 ? Math.max(...programDates) : null
  };
}

export function isStalePlaylistWindow(previous: PlaylistWindow, next: PlaylistWindow): boolean {
  if (next.endSequence < previous.endSequence) return true;
  if (next.endSequence > previous.endSequence) return false;
  if (next.mediaSequence < previous.mediaSequence) return true;
  return (
    previous.lastProgramDateTime !== null &&
    next.lastProgramDateTime !== null &&
    next.lastProgramDateTime < previous.lastProgramDateTime - 1_000
  );
}

function playlistKey(context: PlaylistLoaderContext): string {
  try {
    const url = new URL(context.url);
    url.searchParams.delete("_HLS_msn");
    url.searchParams.delete("_HLS_part");
    url.searchParams.delete("_HLS_skip");
    url.searchParams.delete("_dstream_retry");
    return `${context.type}:${context.level ?? context.id ?? "none"}:${url.toString()}`;
  } catch {
    return `${context.type}:${context.level ?? context.id ?? "none"}:${context.url}`;
  }
}

function retryUrl(input: string, attempt: number): string {
  try {
    const url = new URL(input);
    url.searchParams.set("_dstream_retry", `${Date.now()}-${attempt}`);
    return url.toString();
  } catch {
    return input;
  }
}

export class MonotonicPlaylistLoader implements Loader<PlaylistLoaderContext> {
  private readonly config: any;
  private readonly acceptedWindows: Map<string, PlaylistWindow>;
  private httpLoader: Loader<PlaylistLoaderContext> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private aborted = false;

  context: PlaylistLoaderContext | null = null;
  stats: LoaderStats = emptyStats();

  constructor(config: any) {
    this.config = config;
    const configKey = config as object;
    let acceptedWindows = windowsByConfig.get(configKey);
    if (!acceptedWindows) {
      acceptedWindows = new Map();
      windowsByConfig.set(configKey, acceptedWindows);
    }
    this.acceptedWindows = acceptedWindows;
  }

  destroy(): void {
    this.aborted = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.httpLoader?.destroy();
    this.httpLoader = null;
    this.context = null;
  }

  abort(): void {
    this.aborted = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.httpLoader?.abort();
  }

  getCacheAge(): number | null {
    return this.httpLoader?.getCacheAge?.() ?? null;
  }

  getResponseHeader(name: string): string | null {
    return this.httpLoader?.getResponseHeader?.(name) ?? null;
  }

  load(
    context: PlaylistLoaderContext,
    loaderConfig: LoaderConfiguration,
    callbacks: LoaderCallbacks<PlaylistLoaderContext>
  ): void {
    this.context = context;
    this.aborted = false;
    const key = playlistKey(context);

    const loadAttempt = (attempt: number) => {
      if (this.aborted) return;
      const HttpLoader = this.config.loader;
      const httpLoader = new HttpLoader(this.config) as Loader<PlaylistLoaderContext>;
      this.httpLoader = httpLoader;
      const requestContext = attempt === 0 ? context : { ...context, url: retryUrl(context.url, attempt) };
      const wrappedCallbacks: LoaderCallbacks<PlaylistLoaderContext> = {
        ...callbacks,
        onSuccess: (response, stats, _requestContext, networkDetails) => {
          if (this.aborted || this.httpLoader !== httpLoader) return;
          this.stats = stats;
          const window = typeof response.data === "string" ? inspectPlaylistWindow(response.data) : null;
          const previous = window ? this.acceptedWindows.get(key) : null;
          if (window && previous && isStalePlaylistWindow(previous, window)) {
            httpLoader.destroy();
            if (attempt < STALE_RETRY_LIMIT) {
              this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                loadAttempt(attempt + 1);
              }, 100 * (attempt + 1));
              return;
            }
            callbacks.onError(
              { code: 409, text: "Stale live playlist response rejected." },
              context,
              networkDetails,
              stats
            );
            return;
          }
          if (window) this.acceptedWindows.set(key, window);
          callbacks.onSuccess({ ...response, url: context.url }, stats, context, networkDetails);
        },
        onError: (error, _requestContext, networkDetails, stats) => {
          this.stats = stats;
          callbacks.onError(error, context, networkDetails, stats);
        },
        onTimeout: (stats, _requestContext, networkDetails) => {
          this.stats = stats;
          callbacks.onTimeout(stats, context, networkDetails);
        },
        onAbort: callbacks.onAbort
          ? (stats, _requestContext, networkDetails) => {
              this.stats = stats;
              callbacks.onAbort?.(stats, context, networkDetails);
            }
          : undefined,
        onProgress: callbacks.onProgress
          ? (stats, _requestContext, data, networkDetails) => {
              this.stats = stats;
              callbacks.onProgress?.(stats, context, data, networkDetails);
            }
          : undefined
      };
      httpLoader.load(requestContext, loaderConfig, wrappedCallbacks);
    };

    loadAttempt(0);
  }
}
