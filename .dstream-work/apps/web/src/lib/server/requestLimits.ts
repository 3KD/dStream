export class RequestLimitError extends Error {}

export async function readLimitedBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RequestLimitError("Request body is too large.");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new RequestLimitError("Request body is too large.");
      chunks.push(part.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally { void reader.cancel().catch(() => undefined); }
}

const windows = new Map<string, { count: number; expires: number }>();

export function allowRateLimitedRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  for (const [entry, state] of windows) if (state.expires <= now) windows.delete(entry);
  const current = windows.get(key);
  if (current) { if (current.count >= limit) return false; current.count += 1; return true; }
  if (windows.size >= 10000) return false;
  windows.set(key, { count: 1, expires: now + windowMs });
  return true;
}
