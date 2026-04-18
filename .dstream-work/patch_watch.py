with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import_target = """import { ChevronDown, ChevronUp, Copy, Flag, Star, X, Network } from "lucide-react";"""
import_replacement = """import { ChevronDown, ChevronUp, Copy, Flag, Star, X, Network, Share2, ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";"""

code = code.replace(import_target, import_replacement)

props_block = """  const globalPlayerProps = useMemo(() => ({
    src: playbackStreamUrl,
    fallbackSrc: announce?.status === "live" && canUseLocalFallback ? fallbackUrl : null,
    whepSrc: announce?.status === "live" ? whepUrl : null,
    p2pSwarm,
    integrity,
    isLiveStream: announce?.status === "live",
    overlayTitle: announce?.title,
    contentWarningReason,
    viewerCount: viewerCount ?? undefined,
    onReady: handlePlayerReady
  }), [
    playbackStreamUrl,
    announce?.status,
    canUseLocalFallback,
    fallbackUrl,
    whepUrl,
    p2pSwarm,
    integrity,
    announce?.title,
    contentWarningReason,
    viewerCount,
    handlePlayerReady
  ]);

  const showVideoUnlockGate = videoPaidRequiresUnlock && !videoUnlocked;"""

target_gate = """  const showVideoUnlockGate = videoPaidRequiresUnlock && !videoUnlocked;"""

if target_gate in code and "const globalPlayerProps" not in code:
    code = code.replace(target_gate, props_block)

with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "w") as f:
    f.write(code)

print("PATCHED")
