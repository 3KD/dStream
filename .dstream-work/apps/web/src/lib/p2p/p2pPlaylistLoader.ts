/**
 * Custom HLS.js playlist loader for P2P-only streams.
 *
 * Instead of fetching manifests via HTTP, this loader gets them
 * from the P2P swarm (via the manifest protocol).
 */

import type { P2PSwarm } from "./swarm";

interface LoaderContext {
  url: string;
  responseType?: string;
  rangeStart?: number;
  rangeEnd?: number;
}

interface LoaderStats {
  loading: { start: number; first: number; end: number };
  total: number;
  loaded: number;
  aborted: boolean;
  retry: number;
}

interface LoaderCallbacks {
  onSuccess: (response: any, stats: LoaderStats, context: LoaderContext, networkDetails?: any) => void;
  onError: (error: any, context: LoaderContext, networkDetails?: any, stats?: LoaderStats) => void;
  onTimeout: (stats: LoaderStats, context: LoaderContext, networkDetails?: any) => void;
}

function makeStats(): LoaderStats {
  return {
    loading: { start: 0, first: 0, end: 0 },
    total: 0,
    loaded: 0,
    aborted: false,
    retry: 0,
  };
}

/**
 * HLS.js Loader for P2P-only manifest/playlist loading.
 *
 * Usage: set `pLoader` in HLS.js config:
 * ```
 * new Hls({ pLoader: createP2PPlaylistLoaderClass(swarm) })
 * ```
 */
export function createP2PPlaylistLoaderClass(swarm: P2PSwarm) {
  return class P2PPlaylistLoader {
    private swarm: P2PSwarm;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;
    private context: LoaderContext | null = null;
    private callbacks: LoaderCallbacks | null = null;

    constructor() {
      this.swarm = swarm;
    }

    load(context: LoaderContext, _config: any, callbacks: LoaderCallbacks): void {
      this.context = context;
      this.callbacks = callbacks;

      const stats = makeStats();
      stats.loading.start = performance.now();

      // Try to get manifest from swarm immediately.
      const manifest = this.swarm.getManifest();
      if (manifest) {
        stats.loading.first = performance.now();
        stats.loading.end = performance.now();
        stats.total = manifest.length;
        stats.loaded = manifest.length;
        callbacks.onSuccess(
          { url: context.url, data: manifest },
          stats,
          context,
          { p2p: true }
        );
        return;
      }

      // No manifest yet — request from peers and poll.
      this.swarm.requestManifest();
      this.pollForManifest(stats, context, callbacks, 0);
    }

    private pollForManifest(
      stats: LoaderStats,
      context: LoaderContext,
      callbacks: LoaderCallbacks,
      attempt: number
    ): void {
      if (this.destroyed) return;

      this.pollTimer = setTimeout(() => {
        if (this.destroyed) return;

        const manifest = this.swarm.getManifest();
        if (manifest) {
          stats.loading.first = performance.now();
          stats.loading.end = performance.now();
          stats.total = manifest.length;
          stats.loaded = manifest.length;
          callbacks.onSuccess(
            { url: context.url, data: manifest },
            stats,
            context,
            { p2p: true }
          );
          return;
        }

        // Re-request manifest from peers.
        this.swarm.requestManifest();

        if (attempt > 15) {
          // Give up after ~30 seconds of polling.
          callbacks.onTimeout(stats, context);
          return;
        }

        this.pollForManifest(stats, context, callbacks, attempt + 1);
      }, 2000);
    }

    abort(): void {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    }

    destroy(): void {
      this.destroyed = true;
      this.abort();
    }
  };
}
