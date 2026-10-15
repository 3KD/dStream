export function requestAuthorizationUrl(request: Request): string {
  const url = new URL(request.url);
  // The managed reverse proxy preserves Host and overwrites this single value.
  // Do not trust X-Forwarded-Host or replace the actual request path/query.
  const protocol = request.headers.get("x-forwarded-proto");
  if (protocol === "http" || protocol === "https") url.protocol = `${protocol}:`;
  const host = request.headers.get("host");
  if (host) {
    const authority = new URL(`${url.protocol}//${host}`);
    if (authority.username || authority.password || authority.pathname !== "/" || authority.search || authority.hash) {
      throw new Error("Invalid request authority.");
    }
    url.hostname = authority.hostname;
    url.port = authority.port;
  }
  return url.href;
}
