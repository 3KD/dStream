
import fs from 'fs/promises';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'nip05.json');

interface Nip05Data {
    names: Record<string, string>; // username -> pubkey
}

async function ensureDb() {
    try {
        await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
        await fs.access(DB_PATH);
    } catch {
        await fs.writeFile(DB_PATH, JSON.stringify({ names: {} }, null, 2));
    }
}

export async function getNip05Names(): Promise<Record<string, string>> {
    await ensureDb();
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data).names;
}

export async function setNip05Name(name: string, pubkey: string) {
    await ensureDb();
    const data = JSON.parse(await fs.readFile(DB_PATH, 'utf-8'));
    data.names[name] = pubkey;
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}
