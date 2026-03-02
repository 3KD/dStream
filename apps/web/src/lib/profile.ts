import type { NostrEvent } from "@dstream/protocol";

export interface NostrProfile {
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
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
    nip05: normalizeNip05(content.nip05)
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
