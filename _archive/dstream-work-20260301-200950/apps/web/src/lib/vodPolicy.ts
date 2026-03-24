import type { StreamAnnounce, StreamVodPolicy } from "@dstream/protocol";
import { isLikelyPlayableMediaUrl } from "@/lib/mediaUrl";

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

  if (stream.status === "ended" && isLikelyPlayableMediaUrl(stream.streaming)) {
    return { mode: "public" };
  }

  return { mode: "off" };
}

export function vodModeLabel(policy: StreamVodPolicy): string {
  if (policy.mode === "paid") return "Paid VOD";
  if (policy.mode === "public") return "Public VOD";
  return "VOD Off";
}
