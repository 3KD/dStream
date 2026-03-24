import type { StreamAnnounce, StreamVodPolicy } from "@dstream/protocol";
import { isLikelyLivePlaybackUrl, isLikelyPublicPlayableMediaUrl, isLikelyVodPlaybackUrl } from "./mediaUrl";

function parseAtomic(input: string | undefined): bigint | null {
  if (!input || !/^\d+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    return value >= 0n ? value : null;
  } catch {
    return null;
  }
}

export function formatXmrAtomic(amountAtomic: string): string {
  const parsed = parseAtomic(amountAtomic);
  if (parsed === null) return amountAtomic;
  const whole = parsed / 1_000_000_000_000n;
  const frac = parsed % 1_000_000_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(12, "0").replace(/0+$/, "") || "0"} XMR`;
}

export function resolveVodPolicy(stream: StreamAnnounce): StreamVodPolicy {
  const mode = stream.vod?.mode;
  if (mode === "off" || mode === "public" || mode === "paid") {
    return {
      mode,
      priceAtomic: stream.vod?.priceAtomic,
      currency: stream.vod?.currency,
      accessSeconds: stream.vod?.accessSeconds,
      playlistId: stream.vod?.playlistId,
      accessScope: stream.vod?.accessScope
    };
  }

  if (stream.vodArchiveEnabled === true) {
    return { mode: "public" };
  }

  return { mode: "off" };
}

export function isReplayEligibleStream(stream: StreamAnnounce): boolean {
  const streaming = (stream.streaming ?? "").trim();
  if (stream.status !== "ended") return false;
  if (stream.vodArchiveEnabled !== true) return false;
  if (stream.vodVisibility === "private") return false;
  if (!isLikelyPublicPlayableMediaUrl(streaming)) return false;
  if (isLikelyLivePlaybackUrl(streaming)) return false;

  const mode = resolveVodPolicy(stream).mode;
  const explicitVodPolicy = !!stream.vod?.mode && stream.vod.mode !== "off";
  const hasVodUrlSignal = isLikelyVodPlaybackUrl(streaming);
  if (!explicitVodPolicy && !hasVodUrlSignal) return false;
  if (!hasVodUrlSignal && streaming.toLowerCase().endsWith(".m3u8")) return false;
  return mode === "public" || mode === "paid";
}

export function vodModeLabel(policy: StreamVodPolicy): string {
  if (policy.mode === "paid") return "Paid VOD";
  if (policy.mode === "public") return "Public VOD";
  return "VOD Off";
}
