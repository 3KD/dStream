import type { NostrEvent } from "@dstream/protocol";

export const NIP39_KIND = 10011;

export const SOCIAL_LINK_DEFINITIONS = [
  { platform: "youtube", profileField: "youtube", label: "YouTube", placeholder: "https://youtube.com/@channel" },
  { platform: "twitter", profileField: "twitter", label: "X", placeholder: "https://x.com/username" },
  { platform: "github", profileField: "github", label: "GitHub", placeholder: "https://github.com/username" },
  { platform: "bluesky", profileField: "bluesky", label: "Bluesky", placeholder: "https://bsky.app/profile/name.bsky.social" },
  { platform: "mastodon", profileField: "mastodon", label: "Mastodon", placeholder: "https://mastodon.social/@username" },
  { platform: "telegram", profileField: "telegram", label: "Telegram", placeholder: "https://t.me/username" },
  { platform: "discord", profileField: "discord", label: "Discord", placeholder: "https://discord.gg/invite" }
] as const;

export type SocialLinkPlatform = (typeof SOCIAL_LINK_DEFINITIONS)[number]["platform"];
export type SocialProfileField = (typeof SOCIAL_LINK_DEFINITIONS)[number]["profileField"];

export const NIP39_PLATFORM_DEFINITIONS = [
  { platform: "github", label: "GitHub", identityPlaceholder: "username", proofPlaceholder: "Gist URL or ID" },
  { platform: "twitter", label: "X", identityPlaceholder: "username", proofPlaceholder: "Post URL or ID" },
  { platform: "mastodon", label: "Mastodon", identityPlaceholder: "server.social/@username", proofPlaceholder: "Post URL or ID" },
  { platform: "telegram", label: "Telegram", identityPlaceholder: "numeric user ID", proofPlaceholder: "channel/message" },
  { platform: "bluesky", label: "Bluesky", identityPlaceholder: "name.bsky.social", proofPlaceholder: "Post URL or ID" },
  { platform: "discord", label: "Discord", identityPlaceholder: "username", proofPlaceholder: "server/channel/message" }
] as const;

export type Nip39Platform = (typeof NIP39_PLATFORM_DEFINITIONS)[number]["platform"];

export interface NostrIdentityClaim {
  platform: string;
  identity: string;
  proof: string;
}

export interface NostrIdentityRecord {
  pubkey: string;
  createdAt: number;
  content: string;
  tags: string[][];
  claims: NostrIdentityClaim[];
}

export type Nip39Draft = Record<Nip39Platform, { identity: string; proof: string }>;

function isHex64(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test((input ?? "").trim());
}

function parseHttpsUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function cleanSegment(input: string): string {
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    // Keep the original segment so malformed escaping is rejected by later validation.
  }
  return decoded.trim().replace(/^@/, "").toLowerCase();
}

function hostnameMatches(hostname: string, domains: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function normalizeSocialProfileUrl(platform: SocialLinkPlatform, input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim();
  if (!value || value.length > 2048) return undefined;
  const url = parseHttpsUrl(value);
  if (!url || url.username || url.password) return undefined;

  const allowed =
    platform === "youtube" ? hostnameMatches(url.hostname, ["youtube.com", "youtu.be"])
      : platform === "twitter" ? hostnameMatches(url.hostname, ["x.com", "twitter.com"])
        : platform === "github" ? hostnameMatches(url.hostname, ["github.com"])
          : platform === "bluesky" ? hostnameMatches(url.hostname, ["bsky.app"])
            : platform === "telegram" ? hostnameMatches(url.hostname, ["t.me", "telegram.me"])
              : platform === "discord" ? hostnameMatches(url.hostname, ["discord.com", "discord.gg"])
                : platform === "mastodon" && /^\/@[a-z0-9_.-]+(?:\/|$)/i.test(url.pathname);
  if (!allowed) return undefined;
  url.hash = "";
  return url.toString().replace(/\/$/, url.pathname === "/" ? "" : "/");
}

export function isNip39Platform(input: string): input is Nip39Platform {
  return NIP39_PLATFORM_DEFINITIONS.some((definition) => definition.platform === input);
}

export function emptyNip39Draft(): Nip39Draft {
  return Object.fromEntries(
    NIP39_PLATFORM_DEFINITIONS.map(({ platform }) => [platform, { identity: "", proof: "" }])
  ) as Nip39Draft;
}

export function normalizeNip39Identity(platform: Nip39Platform, input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  let value = input.trim();
  if (!value || value.length > 256) return undefined;

  const url = parseHttpsUrl(value);
  if (url) {
    const path = url.pathname.split("/").filter(Boolean);
    if (platform === "github" && /(^|\.)github\.com$/i.test(url.hostname) && path[0]) value = path[0];
    else if (platform === "twitter" && /(^|\.)(?:twitter|x)\.com$/i.test(url.hostname) && path[0]) value = path[0];
    else if (platform === "mastodon" && path[0]?.startsWith("@")) value = `${url.hostname}/${path[0]}`;
    else if (platform === "bluesky" && /(^|\.)bsky\.app$/i.test(url.hostname) && path[0] === "profile" && path[1]) value = path[1];
  }

  value = value.trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  if (!value || /\s/.test(value)) return undefined;

  if (platform === "github" && !/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(value)) return undefined;
  if (platform === "twitter" && !/^[a-z0-9_]{1,15}$/.test(value)) return undefined;
  if (platform === "mastodon" && !/^[a-z0-9.-]+\/@[a-z0-9_.-]+$/.test(value)) return undefined;
  if (platform === "telegram" && !/^\d+$/.test(value)) return undefined;
  if (platform === "bluesky" && !/^[a-z0-9.-]+$/.test(value)) return undefined;
  if (platform === "discord" && !/^[a-z0-9._-]{1,64}$/.test(value)) return undefined;
  return value;
}

export function normalizeNip39Proof(platform: Nip39Platform, input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  let value = input.trim();
  if (!value || value.length > 1024) return undefined;

  const url = parseHttpsUrl(value);
  if (url) {
    const path = url.pathname.split("/").filter(Boolean).map(cleanSegment);
    if (platform === "github" && /(^|\.)gist\.github\.com$/i.test(url.hostname) && path[1]) value = path[1];
    else if (platform === "twitter" && /(^|\.)(?:twitter|x)\.com$/i.test(url.hostname) && path[1] === "status" && path[2]) value = path[2];
    else if (platform === "mastodon" && path[1]) value = path[1];
    else if (platform === "telegram" && /(^|\.)t\.me$/i.test(url.hostname) && path.length >= 2) value = `${path[path.length - 2]}/${path[path.length - 1]}`;
    else if (platform === "bluesky" && /(^|\.)bsky\.app$/i.test(url.hostname) && path[0] === "profile" && path[2] === "post" && path[3]) value = path[3];
    else if (platform === "discord" && /(^|\.)discord(?:app)?\.com$/i.test(url.hostname) && path[0] === "channels" && path.length >= 4) value = path.slice(1, 4).join("/");
    else return undefined;
  }

  value = value.trim().replace(/^\/+|\/+$/g, "");
  if (!value || /\s/.test(value)) return undefined;
  return value.slice(0, 1024);
}

export function parseNip39Event(event: NostrEvent): NostrIdentityRecord | null {
  if (!event || event.kind !== NIP39_KIND) return null;
  if (!event.pubkey || !isHex64(event.pubkey)) return null;
  if (typeof event.created_at !== "number") return null;

  const tags = Array.isArray(event.tags)
    ? event.tags.filter((tag): tag is string[] => Array.isArray(tag) && tag.every((value) => typeof value === "string"))
    : [];
  const claims: NostrIdentityClaim[] = [];

  for (const tag of tags) {
    if (tag[0] !== "i" || tag.length < 3) continue;
    const pointer = tag[1]?.trim() ?? "";
    const separator = pointer.indexOf(":");
    if (separator <= 0) continue;
    const platform = pointer.slice(0, separator).trim().toLowerCase();
    const identity = pointer.slice(separator + 1).trim();
    const proof = tag[2]?.trim() ?? "";
    if (!/^[a-z0-9._/-]+$/.test(platform) || !identity || !proof) continue;
    claims.push({ platform, identity, proof });
  }

  return {
    pubkey: event.pubkey.toLowerCase(),
    createdAt: Math.floor(event.created_at),
    content: typeof event.content === "string" ? event.content : "",
    tags,
    claims
  };
}

export function nip39DraftFromRecord(record: NostrIdentityRecord | null | undefined): Nip39Draft {
  const draft = emptyNip39Draft();
  for (const claim of record?.claims ?? []) {
    if (!isNip39Platform(claim.platform)) continue;
    if (draft[claim.platform].identity) continue;
    draft[claim.platform] = { identity: claim.identity, proof: claim.proof };
  }
  return draft;
}

export function buildNip39Tags(draft: Nip39Draft): string[][] {
  const tags: string[][] = [];
  for (const { platform } of NIP39_PLATFORM_DEFINITIONS) {
    const identity = normalizeNip39Identity(platform, draft[platform]?.identity);
    const proof = normalizeNip39Proof(platform, draft[platform]?.proof);
    if (!identity || !proof) continue;
    tags.push(["i", `${platform}:${identity}`, proof]);
  }
  return tags;
}

export function mergeNip39Tags(existingTags: string[][], draft: Nip39Draft): string[][] {
  const preserved = existingTags.filter((tag) => {
    if (tag[0] !== "i" || typeof tag[1] !== "string") return true;
    const separator = tag[1].indexOf(":");
    if (separator <= 0) return true;
    return !isNip39Platform(tag[1].slice(0, separator).trim().toLowerCase());
  });
  return [...preserved, ...buildNip39Tags(draft)];
}

export function socialIdentityProfileUrl(claim: NostrIdentityClaim): string | null {
  if (!isNip39Platform(claim.platform)) return null;
  const identity = normalizeNip39Identity(claim.platform, claim.identity);
  if (!identity) return null;
  if (claim.platform === "github") return `https://github.com/${encodeURIComponent(identity)}`;
  if (claim.platform === "twitter") return `https://x.com/${encodeURIComponent(identity)}`;
  if (claim.platform === "mastodon") return `https://${identity}`;
  if (claim.platform === "bluesky") return `https://bsky.app/profile/${encodeURIComponent(identity)}`;
  return null;
}

export function socialIdentityProofUrl(claim: NostrIdentityClaim): string | null {
  if (!isNip39Platform(claim.platform)) return null;
  const identity = normalizeNip39Identity(claim.platform, claim.identity);
  const proof = normalizeNip39Proof(claim.platform, claim.proof);
  if (!identity || !proof) return null;
  if (claim.platform === "github") return `https://gist.github.com/${encodeURIComponent(identity)}/${encodeURIComponent(proof)}`;
  if (claim.platform === "twitter") return `https://twitter.com/${encodeURIComponent(identity)}/status/${encodeURIComponent(proof)}`;
  if (claim.platform === "mastodon") return `https://${identity}/${encodeURIComponent(proof)}`;
  if (claim.platform === "telegram") return `https://t.me/${proof.split("/").map(encodeURIComponent).join("/")}`;
  if (claim.platform === "bluesky") return `https://bsky.app/profile/${encodeURIComponent(identity)}/post/${encodeURIComponent(proof)}`;
  if (claim.platform === "discord") return `https://discord.com/channels/${proof.split("/").map(encodeURIComponent).join("/")}`;
  return null;
}

export function nip39VerificationText(npub: string): string {
  return `Verifying that I control the following Nostr public key: ${npub}`;
}
