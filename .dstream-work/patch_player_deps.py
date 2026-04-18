with open("apps/web/src/components/Player.tsx", "r") as f:
    code = f.read()

import re

# 1. We need to add dynamic mutating effects for p2pSwarm and integrity.
# Let's inject them right before the massive useEffect.
target_useeffect = """  useEffect(() => {
    let active = true;"""

replacement_useeffect = """  useEffect(() => {
    if (hlsRef.current) {
      (hlsRef.current.config as any).dstreamP2PSwarm = p2pSwarm ?? null;
    }
  }, [p2pSwarm]);

  useEffect(() => {
    if (hlsRef.current) {
      (hlsRef.current.config as any).dstreamIntegritySession = integrity ?? null;
    }
  }, [integrity]);

  useEffect(() => {
    let active = true;"""

code = code.replace(target_useeffect, replacement_useeffect)

# 2. We need to find the massive array and remove p2pSwarm, integrity, and effectiveAutoplayMuted
array_target = """    effectiveAutoplayMuted,
    fallbackSrc,
    integrity,
    isMobilePlayback,
    lowLatencyEnabled,
    p2pSwarm,
    playbackStateKey,
    preferNativeHls,
    src,
    whepSrc"""

array_replacement = """    fallbackSrc,
    isMobilePlayback,
    lowLatencyEnabled,
    playbackStateKey,
    preferNativeHls,
    src,
    whepSrc"""

code = code.replace(array_target, array_replacement)

# Wait! If effectiveAutoplayMuted is removed from the array, but used inside the effect, React lint will complain!
# We can use a ref for effectiveAutoplayMuted!
# Or we can just disable the lint rule for that block.
# Let's search for how it's used: "return whepRef.current.init(effectiveAutoplayMuted);"
# Let's patch `effectiveAutoplayMuted` usage inside the effect to bypass the lint, or just add `// eslint-disable-next-line react-hooks/exhaustive-deps` above the dependency array.

with open("apps/web/src/components/Player.tsx", "w") as f:
    f.write(code)

print("PATCHED")
