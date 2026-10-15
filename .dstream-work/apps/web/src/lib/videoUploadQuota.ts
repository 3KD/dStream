import { constants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { join } from "node:path";
import { updateJsonFileAtomic } from "./storage/jsonFileStore";

type Reservation = { host: string; bytes: number; expires: number };

export async function reserveUploadCapacity(root: string, id: string, host: string, bytes: number, expires: number): Promise<void> {
  const videoDir = process.env.DSTREAM_VIDEO_DIR?.trim() || "/recordings";
  await access(videoDir, constants.W_OK).catch(() => { throw new Error("Video uploads require writable recording storage."); });
  const disk = await statfs(videoDir);
  const available = Number(disk.bavail) * Number(disk.bsize);
  const budget = Number(process.env.DSTREAM_VIDEO_UPLOAD_MAX_RESERVED_BYTES || 1024 ** 3);
  const floor = Number(process.env.DSTREAM_VIDEO_UPLOAD_MIN_FREE_BYTES || 256 * 1024 ** 2);
  if (!Number.isSafeInteger(budget) || budget <= 0 || !Number.isSafeInteger(floor) || floor < 0) throw new Error("Upload capacity settings are invalid.");
  updateJsonFileAtomic<Record<string, Reservation>>(join(root, "reservations.json"), {}, (rows) => {
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) throw new Error("Upload reservation store is invalid.");
    const now = Math.floor(Date.now() / 1000);
    for (const [key, row] of Object.entries(rows)) if (row.expires <= now) delete rows[key];
    if (rows[id]) return rows;
    const active = Object.values(rows);
    const reserved = active.reduce((total, row) => total + row.bytes, 0);
    if (!Number.isFinite(reserved) || reserved + bytes > budget || reserved + bytes + floor > available ||
      active.length >= 8 || active.filter((row) => row.host === host).length >= 2) {
      throw new Error("Video upload capacity is exhausted. Try again after an upload completes.");
    }
    rows[id] = { host, bytes, expires };
    return rows;
  });
}

export function releaseUploadCapacity(root: string, id: string): void {
  updateJsonFileAtomic<Record<string, Reservation>>(join(root, "reservations.json"), {}, (rows) => { delete rows[id]; return rows; });
}
