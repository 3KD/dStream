const PLAYBACK_ACCESS_COOKIE_NAME = "dstream_playback_access";

export function buildPlaybackAccessCookies(
  req: Request,
  originStreamId: string,
  token: string,
  expiresAtSec: number
): string[] {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const maxAge = Math.max(1, expiresAtSec - Math.floor(Date.now() / 1000));
  const encodedOriginStreamId = encodeURIComponent(originStreamId);
  const encodedToken = encodeURIComponent(token);
  const suffix = `HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  return [
    `/api/hls/${encodedOriginStreamId}`,
    `/api/whep/${encodedOriginStreamId}`,
    `/api/video/file/${encodedOriginStreamId}`
  ].map((path) => `${PLAYBACK_ACCESS_COOKIE_NAME}=${encodedToken}; Path=${path}; ${suffix}`);
}

export function readPlaybackAccessToken(req: {
  nextUrl: { searchParams: URLSearchParams };
  cookies: { get(name: string): { value: string } | undefined };
}): string | null {
  return req.nextUrl.searchParams.get("access") ?? req.cookies.get(PLAYBACK_ACCESS_COOKIE_NAME)?.value ?? null;
}
