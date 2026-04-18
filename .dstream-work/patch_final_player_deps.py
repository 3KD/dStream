with open("apps/web/src/components/Player.tsx", "r") as f:
    code = f.read()

# 1. Add refs for fallbackSrc and playbackStateKey so the initialization hook can read them without depending on them.
# I will inject these refs right above the p2pSwarm useEffect.
refs_replacement = """  const fallbackSrcRef = useRef(fallbackSrc);
  const playbackStateKeyRef = useRef(playbackStateKey);

  useEffect(() => {
    fallbackSrcRef.current = fallbackSrc;
  }, [fallbackSrc]);

  useEffect(() => {
    playbackStateKeyRef.current = playbackStateKey;
  }, [playbackStateKey]);

  useEffect(() => {
    if (hlsRef.current) {"""

code = code.replace("  useEffect(() => {\n    if (hlsRef.current) {", refs_replacement, 1)

# 2. Update usage of fallbackSrc -> fallbackSrcRef.current inside the massively huge hook
code = code.replace("hasFallbackErrorOption && fallbackSrc && tryHlsBackup", "hasFallbackErrorOption && fallbackSrcRef.current && tryHlsBackup")
code = code.replace("hls.loadSource(fallbackSrc);", "if (fallbackSrcRef.current) hls.loadSource(fallbackSrcRef.current);")

# 3. Update usage of playbackStateKey inside the massively huge hook
code = code.replace("readPersistedPlaybackState(playbackStateKey)", "readPersistedPlaybackState(playbackStateKeyRef.current)")

# 4. Remove fallbackSrc and playbackStateKey from the dependency array at the bottom of the hook
array_target = """    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fallbackSrc,
    isMobilePlayback,
    lowLatencyEnabled,
    playbackStateKey,
    preferNativeHls,
    src,
    whepSrc
  ]);"""

array_replacement = """    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobilePlayback,
    lowLatencyEnabled,
    preferNativeHls,
    src,
    whepSrc
  ]);"""

code = code.replace(array_target, array_replacement)

with open("apps/web/src/components/Player.tsx", "w") as f:
    f.write(code)

print("PATCHED")
