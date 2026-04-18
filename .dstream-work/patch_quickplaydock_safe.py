with open("apps/web/src/components/player/GlobalQuickPlayDock.tsx", "r") as f:
    code = f.read()

target = """  if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc) return null;

  return (
    <div
      onMouseDown={handleContainerMouseDown}
      onTouchStart={handleContainerMouseDown}"""

replacement = """  const globalPlayerProps = useMemo(() => ({
    src: hlsSrc,
    whepSrc,
    autoplayMuted: false,
    backgroundPlayEnabledOverride: backgroundPlayEnabled,
    isLiveStream: true,
    showTimelineControls: false,
    showAuxControls: false,
    showNativeControls: false,
    playbackStateKey
  }), [backgroundPlayEnabled, hlsSrc, playbackStateKey, whepSrc]);

  if (!ready || isWatchRoute || !quickPlayStream || !hlsSrc) return null;

  return (
    <div
      onMouseDown={handleContainerMouseDown}
      onTouchStart={handleContainerMouseDown}"""

target2 = """        <GlobalPlayerSlot
          id="quickplay-dock"
          playerProps={{
            src: hlsSrc,
            whepSrc,
            autoplayMuted: false,
            backgroundPlayEnabledOverride: backgroundPlayEnabled,
            isLiveStream: true,
            showTimelineControls: false,
            showAuxControls: false,
            showNativeControls: false,
            playbackStateKey
          }}
        />"""

replacement2 = """        <GlobalPlayerSlot
          id="quickplay-dock"
          playerProps={globalPlayerProps}
        />"""

if target in code and target2 in code:
    code = code.replace(target, replacement)
    code = code.replace(target2, replacement2)
    with open("apps/web/src/components/player/GlobalQuickPlayDock.tsx", "w") as f:
        f.write(code)
    print("PATCHED QUICK PLAY DOC SAFELY")
else:
    print("NOT FOUND")
