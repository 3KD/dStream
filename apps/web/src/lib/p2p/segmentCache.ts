export class SegmentCache {
  private readonly maxBytes: number;
  private bytes = 0;
  private entries = new Map<string, { data: ArrayBuffer; byteLength: number; addedAt: number }>();

  constructor(opts?: { maxBytes?: number }) {
    this.maxBytes = Math.max(256 * 1024, opts?.maxBytes ?? 24 * 1024 * 1024);
  }

  get totalBytes(): number {
    return this.bytes;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): ArrayBuffer | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return entry.data;
  }

  set(key: string, data: ArrayBuffer): void {
    if (!key) return;
    if (!data) return;

    const byteLength = data.byteLength ?? 0;
    if (byteLength <= 0) return;
    if (byteLength > this.maxBytes) return;

    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.byteLength;
      this.entries.delete(key);
    }

    this.entries.set(key, { data, byteLength, addedAt: Date.now() });
    this.bytes += byteLength;

    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.bytes > this.maxBytes) {
      const firstKey = this.entries.keys().next().value as string | undefined;
      if (!firstKey) return;
      const entry = this.entries.get(firstKey);
      this.entries.delete(firstKey);
      if (entry) this.bytes -= entry.byteLength;
    }
  }
}

