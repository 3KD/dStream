import re

with open("apps/web/src/components/player/GlobalQuickPlayDock.tsx", "r") as f:
    code = f.read()

target = """          <GlobalPlayerSlot
            id="quick-play"
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

replacement = """          <GlobalPlayerSlot
            id="quick-play"
            playerProps={useMemo(() => ({
              src: hlsSrc,
              whepSrc,
              autoplayMuted: false,
              backgroundPlayEnabledOverride: backgroundPlayEnabled,
              isLiveStream: true,
              showTimelineControls: false,
              showAuxControls: false,
              showNativeControls: false,
              playbackStateKey
            }), [backgroundPlayEnabled, hlsSrc, playbackStateKey, whepSrc])}
          />"""

if target in code:
    code = code.replace(target, replacement)
    with open("apps/web/src/components/player/GlobalQuickPlayDock.tsx", "w") as f:
        f.write(code)
    print("PATCHED QUICK PLAY")
else:
    print("NOT FOUND")
