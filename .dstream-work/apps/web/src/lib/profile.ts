import type { NostrEvent } from "@dstream/protocol";

export interface NostrProfile {
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  lud06?: string;
  btc?: string;
  eth?: string;
  trx?: string;
  xmr?: string;
  sol?: string;
  ada?: string;
  doge?: string;
  ltc?: string;
  ton?: string;
  xrp?: string;
  dot?: string;
}

export interface NostrProfileRecord {
  pubkey: string;
  createdAt: number;
  profile: NostrProfile;
}

function normalizeText(input: unknown, maxLen: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) return undefined;
  return value.slice(0, maxLen);
}

function normalizeUrl(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value)) return undefined;
  return value.slice(0, 2048);
}

export function normalizeNip05(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (!/^[_a-z0-9.\-]+@([a-z0-9\-]+\.)+[a-z]{2,}$/i.test(value)) return undefined;
  return value;
}

export function parseProfileContent(contentRaw: string): NostrProfile {
  let content: any = {};
  try {
    content = JSON.parse(contentRaw || "{}");
  } catch {
    content = {};
  }

  return {
    name: normalizeText(content.name, 64),
    displayName: normalizeText(content.display_name ?? content.displayName, 64),
    about: normalizeText(content.about, 500),
    picture: normalizeUrl(content.picture),
    banner: normalizeUrl(content.banner),
    website: normalizeUrl(content.website),
    nip05: normalizeNip05(content.nip05),
    lud16: normalizeNip05(content.lud16),
    lud06: normalizeText(content.lud06, 256),
    btc: normalizeText(content.btc, 128),
    eth: normalizeText(content.eth, 128),
    trx: normalizeText(content.trx, 128),
    xmr: normalizeText(content.xmr, 128),
    sol: normalizeText(content.sol, 128),
    ada: normalizeText(content.ada, 128),
    doge: normalizeText(content.doge, 128),
    ltc: normalizeText(content.ltc, 128),
    ton: normalizeText(content.ton, 128),
    xrp: normalizeText(content.xrp, 128),
    dot: normalizeText(content.dot, 128)
  };
}

export function serializeProfileContent(profile: NostrProfile): string {
  const normalized: Record<string, string> = {};
  if (profile.name) normalized.name = normalizeText(profile.name, 64) ?? profile.name.slice(0, 64);
  if (profile.displayName) normalized.display_name = normalizeText(profile.displayName, 64) ?? profile.displayName.slice(0, 64);
  if (profile.about) normalized.about = normalizeText(profile.about, 500) ?? profile.about.slice(0, 500);
  if (profile.picture) {
    const url = normalizeUrl(profile.picture);
    if (url) normalized.picture = url;
  }
  if (profile.banner) {
    const url = normalizeUrl(profile.banner);
    if (url) normalized.banner = url;
  }
  if (profile.website) {
    const url = normalizeUrl(profile.website);
    if (url) normalized.website = url;
  }
  if (profile.nip05) {
    const nip05 = normalizeNip05(profile.nip05);
    if (nip05) normalized.nip05 = nip05;
  }
  if (profile.lud16) {
    const lud16 = normalizeNip05(profile.lud16);
    if (lud16) normalized.lud16 = lud16;
  }
  if (profile.lud06) {
    const lud06 = normalizeText(profile.lud06, 256);
    if (lud06) normalized.lud06 = lud06;
  }
  if (profile.btc) {
    const btc = normalizeText(profile.btc, 128);
    if (btc) normalized.btc = btc;
  }
  if (profile.eth) {
    const eth = normalizeText(profile.eth, 128);
    if (eth) normalized.eth = eth;
  }
  if (profile.trx) {
    const trx = normalizeText(profile.trx, 128);
    if (trx) normalized.trx = trx;
  }
  if (profile.xmr) {
    const xmr = normalizeText(profile.xmr, 128);
    if (xmr) normalized.xmr = xmr;
  }
  if (profile.sol) { const sol = normalizeText(profile.sol, 128); if (sol) normalized.sol = sol; }
  if (profile.ada) { const ada = normalizeText(profile.ada, 128); if (ada) normalized.ada = ada; }
  if (profile.doge) { const doge = normalizeText(profile.doge, 128); if (doge) normalized.doge = doge; }
  if (profile.ltc) { const ltc = normalizeText(profile.ltc, 128); if (ltc) normalized.ltc = ltc; }
  if (profile.ton) { const ton = normalizeText(profile.ton, 128); if (ton) normalized.ton = ton; }
  if (profile.xrp) { const xrp = normalizeText(profile.xrp, 128); if (xrp) normalized.xrp = xrp; }
  if (profile.dot) { const dot = normalizeText(profile.dot, 128); if (dot) normalized.dot = dot; }
  return JSON.stringify(normalized);
}

export function parseProfileEvent(event: NostrEvent): NostrProfileRecord | null {
  if (!event || event.kind !== 0) return null;
  if (!event.pubkey || !/^[a-f0-9]{64}$/i.test(event.pubkey)) return null;
  if (typeof event.created_at !== "number") return null;
  return {
    pubkey: event.pubkey.toLowerCase(),
    createdAt: Math.floor(event.created_at),
    profile: parseProfileContent(event.content ?? "")
  };
}

export function pickProfileDisplayName(record: NostrProfile | undefined, fallbackPubkey: string): string {
  const display = record?.displayName?.trim() || record?.name?.trim();
  if (display) return display;
  return fallbackPubkey;
}
