import { inspectHlsPlaylist } from "@/lib/hls/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN_STREAM_ID_RE = /^[a-f0-9]{64}--[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function hlsProxyOrigin(): string {
  return (process.env.DSTREAM_HLS_PROXY_ORIGIN?.trim() || "http://localhost:8888").replace(/\/$/, "");
}

export async function GET(_request: Request, context: { params: Promise<{ originStreamId: string }> }): Promise<Response> {
  const { originStreamId } = await context.params;
  if (!ORIGIN_STREAM_ID_RE.test(originStreamId)) {
    return Response.json({ ready: false, reason: "invalid_stream_id", upstreamStatus: null }, { status: 400 });
  }

  const target = `${hlsProxyOrigin()}/${encodeURIComponent(originStreamId)}/index.m3u8`;
  try {
    const upstream = await fetch(target, {
      cache: "no-store",
      headers: { accept: "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain" },
      signal: AbortSignal.timeout(2_500)
    });
    if (!upstream.ok) {
      return Response.json(
        { ready: false, reason: "waiting", upstreamStatus: upstream.status },
        { headers: { "cache-control": "no-store" } }
      );
    }

    const readiness = inspectHlsPlaylist(await upstream.text());
    return Response.json(
      {
        ready: readiness.playable,
        reason: readiness.playable ? "ready" : "playlist_not_playable",
        playlistKind: readiness.kind,
        upstreamStatus: upstream.status
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json(
      { ready: false, reason: "origin_unreachable", upstreamStatus: null },
      { headers: { "cache-control": "no-store" } }
    );
  }
}
