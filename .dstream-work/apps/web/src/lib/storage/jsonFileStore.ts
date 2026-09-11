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

function withFileLock<T>(filePath: string, fn: () => T): T {
  mkdirSync(dirname(filePath), { recursive: true });
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
    return fn();
  } finally {
    releaseFileLock(lock);
  }
}

function readTextFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
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
    const backup = backupPath(filePath);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;

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

export function updateJsonFileAtomic<T>(
  filePath: string,
  fallback: T,
  update: (current: T) => T
): T {
  return withFileLock(filePath, () => {
    const backup = backupPath(filePath);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    let current = fallback;
    let primaryWasValid = false;
    const primaryRaw = readTextFile(filePath);
    const backupRaw = readTextFile(backup);
    if (primaryRaw) {
      try {
        current = JSON.parse(primaryRaw) as T;
        primaryWasValid = true;
      } catch {
        if (!backupRaw) throw new Error(`JSON store is corrupt: ${filePath}`);
        try {
          current = JSON.parse(backupRaw) as T;
        } catch {
          throw new Error(`JSON store and backup are corrupt: ${filePath}`);
        }
      }
    } else if (backupRaw) {
      try {
        current = JSON.parse(backupRaw) as T;
      } catch {
        throw new Error(`JSON store backup is corrupt: ${filePath}`);
      }
    }

    const next = update(current);
    const body = `${JSON.stringify(next, null, 2)}\n`;
    try {
      if (primaryWasValid && existsSync(filePath)) {
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
    return next;
  });
}
