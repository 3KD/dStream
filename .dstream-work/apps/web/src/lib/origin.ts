function isHexPubkey(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test(input);
}

// MediaMTX uses the HTTP path as the stream name; keep it simple and URL-safe.
// This is deliberately derived from canonical stream identity (ADR 0002): `${pubkey}:${streamId}`.
function isSafeStreamId(streamId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(streamId);
}

export function makeOriginStreamId(pubkeyHex: string, streamId: string): string | null {
  const pk = (pubkeyHex ?? "").trim().toLowerCase();
  const id = (streamId ?? "").trim();

  if (!isHexPubkey(pk)) return null;
  if (!isSafeStreamId(id)) return null;

  return `${pk}--${id}`;
}

export function describeOriginStreamIdRules(): string {
  return "Stream ID must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/ (letters, digits, '_' or '-', max 128 chars).";
}

