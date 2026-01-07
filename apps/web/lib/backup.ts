"use client";

/**
 * Backup & Restore Utility
 * 
 * Handles exporting and importing all dStream user data:
 * - Identity (Nostr keys, display name, Monero address)
 * - Stream key and broadcast settings
 * - Trusted/banned peer lists
 */

// LocalStorage keys to backup
const BACKUP_KEYS = [
    'dstream_identity',
    'dstream_key',
    'dstream_settings',
    'dstream_trusted_peers',
    'dstream_banned_peers',
] as const;

export interface BackupData {
    version: number;
    createdAt: string;
    data: Record<string, unknown>;
}

/**
 * Create a backup of all dStream data
 */
export function createBackup(): BackupData {
    const data: Record<string, unknown> = {};

    for (const key of BACKUP_KEYS) {
        const value = localStorage.getItem(key);
        if (value) {
            try {
                data[key] = JSON.parse(value);
            } catch {
                data[key] = value; // Store as-is if not JSON
            }
        }
    }

    // Also backup any ticket keys (ticket_*)
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('ticket_')) {
            const value = localStorage.getItem(key);
            if (value) {
                try {
                    data[key] = JSON.parse(value);
                } catch {
                    data[key] = value;
                }
            }
        }
    }

    return {
        version: 1,
        createdAt: new Date().toISOString(),
        data,
    };
}

/**
 * Validate backup data structure
 */
export function validateBackup(backup: unknown): backup is BackupData {
    if (!backup || typeof backup !== 'object') return false;
    const b = backup as Record<string, unknown>;

    if (typeof b.version !== 'number') return false;
    if (typeof b.createdAt !== 'string') return false;
    if (!b.data || typeof b.data !== 'object') return false;

    // Check for required identity data
    const data = b.data as Record<string, unknown>;
    if (!data.dstream_identity) return false;

    const identity = data.dstream_identity as Record<string, unknown>;
    if (!identity.publicKey || !identity.privateKey) return false;

    return true;
}

/**
 * Restore data from backup
 */
export function restoreBackup(backup: BackupData): void {
    // Clear existing data first
    for (const key of BACKUP_KEYS) {
        localStorage.removeItem(key);
    }

    // Clear any existing tickets
    const ticketKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('ticket_')) {
            ticketKeys.push(key);
        }
    }
    ticketKeys.forEach(key => localStorage.removeItem(key));

    // Restore all data
    for (const [key, value] of Object.entries(backup.data)) {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

/**
 * Trigger download of backup file
 */
export function downloadBackup(backup: BackupData): void {
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().split('T')[0];
    const filename = `dstream-backup-${date}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Parse backup file content
 */
export function parseBackupFile(content: string): BackupData | null {
    try {
        const parsed = JSON.parse(content);
        if (validateBackup(parsed)) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get summary of backup contents for preview
 */
export function getBackupSummary(backup: BackupData): {
    hasIdentity: boolean;
    displayName: string | null;
    hasStreamKey: boolean;
    hasSettings: boolean;
    trustedPeersCount: number;
    bannedPeersCount: number;
    ticketCount: number;
} {
    const data = backup.data;
    const identity = data.dstream_identity as Record<string, unknown> | undefined;
    const trustedPeers = data.dstream_trusted_peers as string[] | undefined;
    const bannedPeers = data.dstream_banned_peers as string[] | undefined;

    const ticketCount = Object.keys(data).filter(k => k.startsWith('ticket_')).length;

    return {
        hasIdentity: !!identity,
        displayName: identity?.displayName as string | null,
        hasStreamKey: !!data.dstream_key,
        hasSettings: !!data.dstream_settings,
        trustedPeersCount: trustedPeers?.length ?? 0,
        bannedPeersCount: bannedPeers?.length ?? 0,
        ticketCount,
    };
}
