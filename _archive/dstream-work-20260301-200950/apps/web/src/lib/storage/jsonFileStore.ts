import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

function backupPath(filePath: string): string {
  return `${filePath}.bak`;
}

function lockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function sleep(ms: number): void {
  const target = Date.now() + ms;
  while (Date.now() < target) {}
}

function tryAcquireFileLock(path: string): boolean {
  try {
    mkdirSync(path, { recursive: false });
    return true;
  } catch {
    return false;
  }
}

function releaseFileLock(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // no-op
  }
}

function withFileLock(filePath: string, fn: () => void): void {
  const lock = lockPath(filePath);
  const startedAt = Date.now();
  const timeoutMs = 5000;
  while (!tryAcquireFileLock(lock)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out acquiring lock for ${filePath}`);
    }
    sleep(25);
  }
  try {
    fn();
  } finally {
    releaseFileLock(lock);
  }
}

export function readTextFileWithBackup(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    // fall through to backup read
  }

  try {
    return readFileSync(backupPath(filePath), "utf8");
  } catch {
    return null;
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  withFileLock(filePath, () => {
    const baseDir = dirname(filePath);
    const backup = backupPath(filePath);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;

    mkdirSync(baseDir, { recursive: true });
    const body = `${JSON.stringify(value, null, 2)}\n`;

    try {
      if (existsSync(filePath)) {
        try {
          copyFileSync(filePath, backup);
        } catch {
          // no-op
        }
      }

      writeFileSync(tempPath, body, "utf8");
      renameSync(tempPath, filePath);
    } finally {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // no-op
      }
    }
  });
}
