function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function isSha256Supported(): boolean {
  const cryptoObj = (globalThis as any).crypto;
  return !!cryptoObj?.subtle?.digest;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  const cryptoObj = (globalThis as any).crypto;
  const subtle: SubtleCrypto | undefined = cryptoObj?.subtle;
  if (!subtle?.digest) return null;
  try {
    const digest = await subtle.digest("SHA-256", data);
    return toHex(digest);
  } catch {
    return null;
  }
}

