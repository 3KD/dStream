import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getLatestStreamAnnounce } from "@/lib/server/streamAnnounceLookup";
import { parseOriginStreamScope } from "@/lib/server/streamScope";
import { verifyVodAccessToken, type VodAccessTokenV1 } from "@/lib/vod/accessToken";
import { resolveVodPolicy } from "@/lib/vodPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOrigin(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  const base = raw || fallback;
  return base.replace(/\/$/, "");
}

const PROXY_ORIGIN = normalizeOrigin(process.env.DSTREAM_HLS_PROXY_ORIGIN, "http://localhost:8888");
const VOD_ACCESS_QUERY_PARAM = "vat";
const VOD_COOKIE_PREFIX = "dstream_vod_access_v1_";

function parsePositiveAtomic(input: string | undefined): bigint | null {
  if (!input || !/^\d+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

function isPlaylistPath(pathSegments: string[]): boolean {
  const last = (pathSegments[pathSegments.length - 1] || "").toLowerCase();
  return last.endsWith(".m3u8");
}

function makeVodAccessCookieName(streamPubkey: string, streamId: string): string {
  const digest = crypto.createHash("sha256").update(`${streamPubkey}:${streamId}`, "utf8").digest("hex").slice(0, 24);
  return `${VOD_COOKIE_PREFIX}${digest}`;
}

function isTokenValidForScope(
  payload: VodAccessTokenV1 | null,
  scope: { streamPubkey: string; streamId: string; accessScope: "stream" | "playlist"; playlistId?: string },
  nowMs: number
): payload is VodAccessTokenV1 {
  if (!payload) return false;
  if (payload.streamPubkey !== scope.streamPubkey) return false;
  const tokenScope = payload.accessScope === "playlist" ? "playlist" : "stream";
  if (scope.accessScope === "playlist") {
    if (tokenScope !== "playlist") return false;
    if (!scope.playlistId || payload.playlistId !== scope.playlistId) return false;
  } else {
    if (tokenScope !== "stream") return false;
    if (payload.streamId !== scope.streamId) return false;
  }
  if (!Number.isFinite(payload.expMs) || payload.expMs <= nowMs) return false;
  return true;
}

function shouldUseSecureCookies(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return proto.toLowerCase() === "https";
}

function serializeAccessCookie(
  req: NextRequest,
  cookieName: string,
  token: string,
  expiresAtMs: number
): string {
  const maxAge = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/api/hls",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (shouldUseSecureCookies(req)) parts.push("Secure");
  return parts.join("; ");
}

function serializeClearCookie(req: NextRequest, cookieName: string): string {
  const parts = [`${cookieName}=`, "Path=/api/hls", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (shouldUseSecureCookies(req)) parts.push("Secure");
  return parts.join("; ");
}

type VodAccessDecision = {
  enforce: boolean;
  authorized: boolean;
  cookieName: string | null;
  refreshToken: string | null;
  refreshExpiresAtMs: number | null;
  clearCookie: boolean;
};

async function evaluateVodAccess(req: NextRequest, pathSegments: string[]): Promise<VodAccessDecision> {
  const scope = parseOriginStreamScope(pathSegments[0]);
  if (!scope) {
    return {
      enforce: false,
      authorized: true,
      cookieName: null,
      refreshToken: null,
      refreshExpiresAtMs: null,
      clearCookie: false
    };
  }

  const announce = await getLatestStreamAnnounce(scope.streamPubkey, scope.streamId);
  if (!announce) {
    return {
      enforce: false,
      authorized: true,
      cookieName: null,
      refreshToken: null,
      refreshExpiresAtMs: null,
      clearCookie: false
    };
  }

  const vodPolicy = resolveVodPolicy(announce);
  const priceAtomic = parsePositiveAtomic(vodPolicy.priceAtomic);
  const enforce =
    announce.status === "ended" &&
    vodPolicy.mode === "paid" &&
    (vodPolicy.currency ?? "xmr").toLowerCase() === "xmr" &&
    priceAtomic !== null;
  const playlistId = (vodPolicy.playlistId ?? "").trim() || undefined;
  const accessScope = vodPolicy.accessScope === "playlist" && playlistId ? "playlist" : "stream";

  if (!enforce) {
    return {
      enforce: false,
      authorized: true,
      cookieName: null,
      refreshToken: null,
      refreshExpiresAtMs: null,
      clearCookie: false
    };
  }

  const cookieName = makeVodAccessCookieName(scope.streamPubkey, scope.streamId);
  const nowMs = Date.now();
  const queryTokenRaw = (req.nextUrl.searchParams.get(VOD_ACCESS_QUERY_PARAM) ?? "").trim();
  const cookieTokenRaw = (req.cookies.get(cookieName)?.value ?? "").trim();

  const queryPayload = verifyVodAccessToken(queryTokenRaw);
  if (isTokenValidForScope(queryPayload, { ...scope, accessScope, playlistId }, nowMs)) {
    return {
      enforce: true,
      authorized: true,
      cookieName,
      refreshToken: queryTokenRaw,
      refreshExpiresAtMs: queryPayload.expMs,
      clearCookie: false
    };
  }

  const cookiePayload = verifyVodAccessToken(cookieTokenRaw);
  if (isTokenValidForScope(cookiePayload, { ...scope, accessScope, playlistId }, nowMs)) {
    return {
      enforce: true,
      authorized: true,
      cookieName,
      refreshToken: null,
      refreshExpiresAtMs: null,
      clearCookie: false
    };
  }

  return {
    enforce: true,
    authorized: false,
    cookieName,
    refreshToken: null,
    refreshExpiresAtMs: null,
    clearCookie: !!cookieTokenRaw
  };
}

async function proxy(req: NextRequest, pathSegments: string[]): Promise<Response> {
  let accessDecision: VodAccessDecision;
  try {
    accessDecision = await evaluateVodAccess(req, pathSegments);
  } catch {
    accessDecision = {
      enforce: false,
      authorized: true,
      cookieName: null,
      refreshToken: null,
      refreshExpiresAtMs: null,
      clearCookie: false
    };
  }

  if (accessDecision.enforce && !accessDecision.authorized) {
    const unauthorized = new Response(
      "VOD access token required for this paid replay.",
      {
        status: isPlaylistPath(pathSegments) ? 402 : 403,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        }
      }
    );
    if (accessDecision.cookieName && accessDecision.clearCookie) {
      unauthorized.headers.append("set-cookie", serializeClearCookie(req, accessDecision.cookieName));
    }
    return unauthorized;
  }

  const base = PROXY_ORIGIN.endsWith("/") ? PROXY_ORIGIN : `${PROXY_ORIGIN}/`;
  const target = new URL(pathSegments.map((s) => encodeURIComponent(s)).join("/"), base);
  const targetParams = new URLSearchParams(req.nextUrl.searchParams);
  targetParams.delete(VOD_ACCESS_QUERY_PARAM);
  target.search = targetParams.toString();

  const headers = new Headers(req.headers);
  headers.delete("host");

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual"
    });

    const resHeaders = new Headers(upstream.headers);
    resHeaders.set("cache-control", "no-store");
    if (accessDecision.cookieName && accessDecision.refreshToken && accessDecision.refreshExpiresAtMs) {
      resHeaders.append(
        "set-cookie",
        serializeAccessCookie(req, accessDecision.cookieName, accessDecision.refreshToken, accessDecision.refreshExpiresAtMs)
      );
    }
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
  } catch (err: any) {
    const message = `HLS proxy error: failed to reach ${PROXY_ORIGIN} (${err?.message ?? "unknown error"})`;
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
