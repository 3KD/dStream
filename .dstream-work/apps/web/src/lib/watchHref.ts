import { isLikelyPublicPlayableMediaUrl } from "@/lib/mediaUrl";

export function buildWatchHref(pubkeyParam: string, streamId: string, streamingHint?: string | null): string {
  const pathname = `/watch/${encodeURIComponent(pubkeyParam)}/${encodeURIComponent(streamId)}`;
  const hint = (streamingHint ?? "").trim();
  if (!isLikelyPublicPlayableMediaUrl(hint)) return pathname;
  const params = new URLSearchParams();
  params.set("u", hint);
  return `${pathname}?${params.toString()}`;
}
