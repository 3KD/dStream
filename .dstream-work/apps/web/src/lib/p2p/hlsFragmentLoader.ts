import type { FragmentLoaderContext, Loader, LoaderCallbacks, LoaderConfiguration, LoaderStats } from "hls.js";
import type { P2PSwarm } from "./swarm";
import type { IntegritySession, IntegritySource } from "../integrity/session";

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function makeStats(byteLength = 0): LoaderStats {
  const t = nowMs();
  return {
    aborted: false,
    loaded: byteLength,
    retry: 0,
    total: byteLength,
    chunkCount: 1,
    bwEstimate: 0,
    loading: { start: t, first: t, end: t },
    parsing: { start: t, end: t },
    buffering: { start: t, first: t, end: t }
  };
}

function looksLikeSegment(url: string): boolean {
  const u = (url || "").toLowerCase();
  return u.includes("/api/hls/") && (u.includes(".ts") || u.includes(".m4s") || u.includes(".mp4"));
}

function basenameNoQuery(url: string): string {
  const raw = (url || "").split("#")[0] ?? "";
  const noQuery = raw.split("?")[0] ?? "";
  const parts = noQuery.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function renditionFromHlsApiUrl(url: string): string | null {
  const clean = (url || "").split("#")[0]?.split("?")[0] ?? "";
  const marker = "/api/hls/";
  const idx = clean.indexOf(marker);
  if (idx < 0) return null;
  const rel = clean.slice(idx + marker.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const streamDir = parts[0] ?? "";
  const suffix = streamDir.match(/__r([0-9]{3,4}p)$/);
  if (suffix?.[1]) return suffix[1];
  const playlist = parts[parts.length - 1] ?? "";
  if (playlist.toLowerCase().endsWith(".m3u8") && playlist.toLowerCase() !== "index.m3u8") {
    return playlist.slice(0, -5);
  }
  return null;
}

function renditionIdFromFrag(context: FragmentLoaderContext): string {
  const base = (context.frag as any)?.baseurl ?? "";
  const byApiPath = renditionFromHlsApiUrl(String(base));
  if (byApiPath) return byApiPath;
  const baseName = basenameNoQuery(String(base));
  if (baseName.toLowerCase().endsWith(".m3u8")) return baseName.slice(0, -5);
  return "index";
}

function uriFromFrag(context: FragmentLoaderContext, url: string): string {
  const rel = (context.frag as any)?.relurl;
  if (typeof rel === "string" && rel.trim().length > 0) return rel;
  return basenameNoQuery(url);
}

export class P2PFragmentLoader implements Loader<FragmentLoaderContext> {
  private readonly config: any;
  private readonly httpLoader: Loader<FragmentLoaderContext>;
  private readonly swarm: P2PSwarm | null;
  private readonly integrity: IntegritySession | null;
  private readonly httpRewrite: { from: string; to: string } | null;
  private aborted = false;

  context: FragmentLoaderContext | null = null;
  stats: LoaderStats = makeStats(0);

  constructor(config: any) {
    this.config = config;
    const HttpLoader = config.loader;
    this.httpLoader = new HttpLoader(config);
    this.swarm = (config as any)?.dstreamP2PSwarm ?? null;
    this.integrity = (config as any)?.dstreamIntegritySession ?? null;
    this.httpRewrite = (config as any)?.dstreamIntegrityHttpRewrite ?? null;
  }

  destroy(): void {
    this.httpLoader.destroy();
    this.context = null;
  }

  abort(): void {
    this.aborted = true;
    try {
      this.httpLoader.abort();
    } catch {
      // ignore
    }
  }

  load(context: FragmentLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<FragmentLoaderContext>): void {
    this.context = context;
    this.aborted = false;

    const url = context.url;
    const renditionId = renditionIdFromFrag(context);
    const uri = uriFromFrag(context, url);

    const rewriteHttpUrl = (input: string): string | null => {
      if (!this.httpRewrite) return null;
      if (!input.includes(this.httpRewrite.from)) return null;
      const out = input.replace(this.httpRewrite.from, this.httpRewrite.to);
      return out === input ? null : out;
    };

    const verify = async (data: ArrayBuffer, source: IntegritySource) => {
      if (!this.integrity) return { ok: true, verified: false };
      return await this.integrity.verifySegment({ renditionId, uri, data, source });
    };

    const attemptP2P = async () => {
      if (!this.swarm) return null;
      if (!looksLikeSegment(url)) return null;
      try {
        return await this.swarm.requestSegment(url, { timeoutMs: 180 });
      } catch {
        return null;
      }
    };

    void (async () => {
      const p2pData = await attemptP2P();
      if (this.aborted) return;

      if (p2pData?.data) {
        const v = await verify(p2pData.data, { t: "p2p", peerPubkey: p2pData.peerPubkey });
        if (this.aborted) return;

        if (!v.ok) {
          try {
            this.swarm?.dropPeer(p2pData.peerPubkey);
          } catch {
            // ignore
          }
          // Fall back to HTTP.
        } else {
          try {
            if (this.swarm && (!this.integrity?.enabled || v.verified)) this.swarm.storeSegment(url, p2pData.data);
          } catch {
            // ignore
          }

          this.stats = makeStats(p2pData.data.byteLength);
          callbacks.onSuccess({ url, data: p2pData.data, code: 200 }, this.stats, context, { p2p: true, integrity: v });
          return;
        }
      }

      const loadHttp = (ctx: FragmentLoaderContext, allowRewrite: boolean) => {
        const wrapped: LoaderCallbacks<FragmentLoaderContext> = {
          ...callbacks,
          onSuccess: (response, stats, _ctx, net) => {
            void (async () => {
              if (this.aborted) return;
              const buf = response?.data instanceof ArrayBuffer ? response.data : null;
              if (buf) {
                const v = await verify(buf, { t: "http", url: ctx.url });
                if (this.aborted) return;
                if (!v.ok) {
                  const fallbackUrl = allowRewrite ? rewriteHttpUrl(ctx.url) : null;
                  if (fallbackUrl) {
                    loadHttp({ ...ctx, url: fallbackUrl }, false);
                    return;
                  }
                  callbacks.onError({ code: 498, text: "Integrity verification failed." }, context, net, stats);
                  return;
                }
                try {
                  if (this.swarm && (!this.integrity?.enabled || v.verified)) this.swarm.storeSegment(url, buf);
                } catch {
                  // ignore
                }
              }
              callbacks.onSuccess({ ...response, url }, stats, context, net);
            })();
          }
        };

        try {
          this.httpLoader.load(ctx, config, wrapped);
        } catch (e: any) {
          callbacks.onError({ code: 0, text: e?.message ?? "loader error" }, context, null, this.stats);
        }
      };

      try {
        loadHttp(context, true);
      } catch {
        // loadHttp handles errors
      }
    })();
  }
}
