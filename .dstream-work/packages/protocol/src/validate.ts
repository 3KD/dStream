export function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function requireNonEmpty(value: string, name: string): string {
  if (!value || value.trim().length === 0) throw new Error(`${name} is required`);
  return value;
}

export function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

