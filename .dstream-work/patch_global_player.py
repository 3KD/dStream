with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

bad_block = """  const globalPlayerProps = useMemo(() => ({
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
  ]);"""

good_block = """  const globalPlayerProps = useMemo(() => ({
    src: playbackStreamUrl,
    fallbackSrc: announce?.status === "live" && canUseLocalFallback ? fallbackUrl : null,
    whepSrc: whepSrc,
    p2pSwarm: p2pSwarm,
    integrity: integritySession,
    isLiveStream: announce?.status !== "ended",
    showNativeControls: false,
    captionTracks: captionTracks,
    viewerCount: viewerCount,
    p2pPeers: p2pStats?.peersConnected,
    autoplayMuted: e2e ? true : social.settings.playbackAutoplayMuted,
    layoutMode: mobilePortraitLayout ? "aspect" : "fill",
    overlayTitle: announce?.title ?? "Live Stream",
    auxMetaSlot: pubkey ? (
      <button
        type="button"
        onClick={() => social.toggleFavoriteStream(pubkey, streamId)}
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200"
        title={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite" : "Favorite"}
        aria-label={social.isFavoriteStream(pubkey, streamId) ? "Unfavorite stream" : "Favorite stream"}
      >
        <Star
          className={`w-3.5 h-3.5 ${
            social.isFavoriteStream(pubkey, streamId) ? "fill-yellow-400 text-yellow-400" : "text-neutral-400"
          }`}
        />
      </button>
    ) : null,
    onReady: () => {
      if (!e2e || e2eSentRef.current.player) return;
      e2eSentRef.current.player = true;
      postE2E({ type: "dstream:e2e", t: "watch_player_ready", streamPubkey: pubkey ?? "", streamId });
    }
  }), [
    playbackStreamUrl,
    announce?.status,
    canUseLocalFallback,
    fallbackUrl,
    whepSrc,
    p2pSwarm,
    integritySession,
    captionTracks,
    viewerCount,
    p2pStats?.peersConnected,
    e2e,
    social,
    mobilePortraitLayout,
    announce?.title,
    pubkey,
    streamId
  ]);"""

if bad_block in code:
    code = code.replace(bad_block, good_block)
    with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "w") as f:
        f.write(code)
    print("PATCHED")
else:
    print("NOT FOUND")

