export function normalizeStakeRequiredAtomic(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value) > 0n ? value : null;
  } catch {
    return null;
  }
}

export function isP2pStakeSatisfied(
  requiredAtomic: string | null | undefined,
  confirmedAtomic: string | null | undefined
): boolean {
  const required = normalizeStakeRequiredAtomic(requiredAtomic);
  if (!required) return true;
  const confirmed = (confirmedAtomic ?? "").trim();
  if (!/^\d+$/.test(confirmed)) return false;
  try {
    return BigInt(confirmed) >= BigInt(required);
  } catch {
    return false;
  }
}

export function canEnableP2pAssist(input: {
  hasSignalIdentity: boolean;
  hasConnectedIdentity: boolean;
  hasNip04: boolean;
  requiredAtomic: string | null | undefined;
  confirmedAtomic: string | null | undefined;
}): boolean {
  if (!input.hasSignalIdentity) return false;
  const required = normalizeStakeRequiredAtomic(input.requiredAtomic);
  if (!required) return true;
  if (!input.hasConnectedIdentity || !input.hasNip04) return false;
  return isP2pStakeSatisfied(required, input.confirmedAtomic);
}
