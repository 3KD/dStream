with open("apps/web/src/components/Player.tsx", "r") as f:
    code = f.read()

# 1. Strip the incorrectly placed refs block
bad_block = """  const fallbackSrcRef = useRef(fallbackSrc);
  const playbackStateKeyRef = useRef(playbackStateKey);

  useEffect(() => {
    fallbackSrcRef.current = fallbackSrc;
  }, [fallbackSrc]);

  useEffect(() => {
    playbackStateKeyRef.current = playbackStateKey;
  }, [playbackStateKey]);

"""
code = code.replace(bad_block, "")

# 2. Inject the refs block safely at the top where other refs are declared
target_refs = """  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<PlaybackMode>("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);"""

replacement_refs = """  const whepRef = useRef<WhepClient | null>(null);
  const playbackModeRef = useRef<PlaybackMode>("hls");
  const onReadyRef = useRef(onReady);
  const selectedQualityRef = useRef(-1);

  const fallbackSrcRef = useRef(fallbackSrc);
  const playbackStateKeyRef = useRef(playbackStateKey);

  useEffect(() => {
    fallbackSrcRef.current = fallbackSrc;
  }, [fallbackSrc]);

  useEffect(() => {
    playbackStateKeyRef.current = playbackStateKey;
  }, [playbackStateKey]);"""

code = code.replace(target_refs, replacement_refs)

with open("apps/web/src/components/Player.tsx", "w") as f:
    f.write(code)

print("PATCHED REFS")
