import type { StreamAnnounce, StreamVideoPolicy } from "@dstream/protocol";
import { isLikelyLivePlaybackUrl, isLikelyPublicPlayableMediaUrl, isLikelyVideoPlaybackUrl } from "./mediaUrl";

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

export function resolveVideoPolicy(stream: StreamAnnounce): StreamVideoPolicy {
  const mode = stream.video?.mode;
  if (mode === "off" || mode === "public" || mode === "paid") {
    return {
      mode,
      priceAtomic: stream.video?.priceAtomic,
      currency: stream.video?.currency,
      accessSeconds: stream.video?.accessSeconds,
      playlistId: stream.video?.playlistId,
      accessScope: stream.video?.accessScope
    };
  }

  if (stream.videoArchiveEnabled === true) {
    return { mode: "public" };
  }

  return { mode: "off" };
}

export function isReplayEligibleStream(stream: StreamAnnounce): boolean {
  if (stream.status !== "ended") return false;
  if (stream.videoVisibility === "private") return false;
  
  const policy = resolveVideoPolicy(stream);
  if (policy.mode === "off") return false;

  return true;
}

export function videoModeLabel(policy: StreamVideoPolicy): string {
  if (policy.mode === "paid") return "Paid Video";
  if (policy.mode === "public") return "Public Video";
  return "Video Off";
}
