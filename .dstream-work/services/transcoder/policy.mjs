export function restartDelayMs(failureCount, baseMs, maxMs) {
  const failures = Math.max(1, Math.trunc(Number(failureCount) || 1));
  const base = Math.max(1, Math.trunc(Number(baseMs) || 1));
  const max = Math.max(base, Math.trunc(Number(maxMs) || base));
  return Math.min(max, base * 2 ** Math.min(failures - 1, 30));
}

export function restartDecision({
  failureCount,
  runDurationMs,
  resetAfterMs,
  baseMs,
  maxMs,
  circuitFailures,
  circuitCooldownMs
}) {
  const reset = Number(runDurationMs) >= Math.max(1, Number(resetAfterMs) || 1);
  const nextFailureCount = (reset ? 0 : Math.max(0, Number(failureCount) || 0)) + 1;
  const threshold = Math.max(1, Math.trunc(Number(circuitFailures) || 1));
  if (nextFailureCount >= threshold) {
    return {
      failureCount: 0,
      delayMs: Math.max(1, Math.trunc(Number(circuitCooldownMs) || 1)),
      circuitOpen: true
    };
  }
  return {
    failureCount: nextFailureCount,
    delayMs: restartDelayMs(nextFailureCount, baseMs, maxMs),
    circuitOpen: false
  };
}
