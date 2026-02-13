import { pubkeyParamToHex } from "../nostr-ids";
import { makeOriginStreamId } from "../origin";

export type P2PPeerMode = "any" | "trusted_only";
export type BroadcastHostMode = "p2p_economy" | "host_only";

export interface SocialSettingsV1 {
  presenceEnabled: boolean;
  p2pAssistEnabled: boolean;
  p2pPeerMode: P2PPeerMode;
  playbackAutoplayMuted: boolean;
  broadcastHostMode: BroadcastHostMode;
  broadcastRebroadcastThreshold: number;
  paymentDefaults: {
    xmrTipAddress: string;
    stakeXmr: string;
    stakeNote: string;
  };
}

export interface SocialStateV1 {
  version: 1;
  aliases: Record<string, string>;
  trustedPubkeys: string[];
  mutedPubkeys: string[];
  blockedPubkeys: string[];
  favorites: {
    creators: string[];
    streams: string[];
  };
  settings: SocialSettingsV1;
}

function isHexPubkey(input: string): boolean {
  return /^[a-f0-9]{64}$/i.test(input);
}

export function normalizePubkey(inputRaw: string): string | null {
  const raw = (inputRaw ?? "").trim();
  if (!raw) return null;
  if (isHexPubkey(raw)) return raw.toLowerCase();
  return pubkeyParamToHex(raw);
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list));
}

function normalizePubkeyList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return uniq(
    input
      .map((v: unknown) => (typeof v === "string" ? normalizePubkey(v) : null))
      .filter((v): v is string => !!v)
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeAliasValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, 48);
}

function normalizeAliases(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as any)) {
    const pk = normalizePubkey(k);
    const alias = normalizeAliasValue(v);
    if (!pk || !alias) continue;
    out[pk] = alias;
  }
  return out;
}

export function makeStreamFavoriteKey(streamPubkeyHex: string, streamId: string): string | null {
  return makeOriginStreamId(streamPubkeyHex, streamId);
}

export function parseStreamFavoriteKey(keyRaw: string): { streamPubkeyHex: string; streamId: string } | null {
  const key = (keyRaw ?? "").trim();
  if (key.length < 67) return null;
  const pubkey = key.slice(0, 64);
  if (!isHexPubkey(pubkey)) return null;
  if (key.slice(64, 66) !== "--") return null;
  const streamId = key.slice(66);
  const validated = makeOriginStreamId(pubkey.toLowerCase(), streamId);
  if (!validated) return null;
  return { streamPubkeyHex: pubkey.toLowerCase(), streamId };
}

function normalizeFavorites(input: unknown): SocialStateV1["favorites"] {
  if (!input || typeof input !== "object") return { creators: [], streams: [] };
  const creators = normalizePubkeyList((input as any).creators);
  const streamsRaw: unknown[] = Array.isArray((input as any).streams) ? ((input as any).streams as unknown[]) : [];
  const streams = uniq(
    streamsRaw
      .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
      .map((v) => parseStreamFavoriteKey(v))
      .filter((v): v is { streamPubkeyHex: string; streamId: string } => !!v)
      .map((v) => makeStreamFavoriteKey(v.streamPubkeyHex, v.streamId))
      .filter((v): v is string => !!v)
  ).sort((a, b) => a.localeCompare(b));

  return { creators, streams };
}

function normalizeSettings(input: unknown): SocialSettingsV1 {
  const defaults = createDefaultSocialState().settings;
  if (!input || typeof input !== "object") return defaults;

  const payment = (input as any).paymentDefaults;
  const paymentDefaults = {
    xmrTipAddress: typeof payment?.xmrTipAddress === "string" ? payment.xmrTipAddress.trim() : defaults.paymentDefaults.xmrTipAddress,
    stakeXmr: typeof payment?.stakeXmr === "string" ? payment.stakeXmr.trim() : defaults.paymentDefaults.stakeXmr,
    stakeNote: typeof payment?.stakeNote === "string" ? payment.stakeNote.trim() : defaults.paymentDefaults.stakeNote
  };

  const modeRaw = (input as any).p2pPeerMode;
  const p2pPeerMode: P2PPeerMode = modeRaw === "trusted_only" || modeRaw === "any" ? modeRaw : defaults.p2pPeerMode;
  const broadcastHostModeRaw = (input as any).broadcastHostMode;
  const broadcastHostMode: BroadcastHostMode =
    broadcastHostModeRaw === "host_only" || broadcastHostModeRaw === "p2p_economy" ? broadcastHostModeRaw : defaults.broadcastHostMode;
  const broadcastThresholdRaw = (input as any).broadcastRebroadcastThreshold;
  const parsedThreshold = Number(broadcastThresholdRaw);
  const broadcastRebroadcastThreshold =
    Number.isInteger(parsedThreshold) && parsedThreshold > 0
      ? Math.max(1, Math.min(Math.trunc(parsedThreshold), 64))
      : defaults.broadcastRebroadcastThreshold;

  return {
    presenceEnabled: typeof (input as any).presenceEnabled === "boolean" ? (input as any).presenceEnabled : defaults.presenceEnabled,
    p2pAssistEnabled: typeof (input as any).p2pAssistEnabled === "boolean" ? (input as any).p2pAssistEnabled : defaults.p2pAssistEnabled,
    p2pPeerMode,
    playbackAutoplayMuted:
      typeof (input as any).playbackAutoplayMuted === "boolean"
        ? (input as any).playbackAutoplayMuted
        : defaults.playbackAutoplayMuted,
    broadcastHostMode,
    broadcastRebroadcastThreshold,
    paymentDefaults
  };
}

export function createDefaultSocialState(): SocialStateV1 {
  return {
    version: 1,
    aliases: {},
    trustedPubkeys: [],
    mutedPubkeys: [],
    blockedPubkeys: [],
    favorites: {
      creators: [],
      streams: []
    },
    settings: {
      presenceEnabled: true,
      p2pAssistEnabled: true,
      p2pPeerMode: "any",
      playbackAutoplayMuted: true,
      broadcastHostMode: "p2p_economy",
      broadcastRebroadcastThreshold: 6,
      paymentDefaults: {
        xmrTipAddress: "",
        stakeXmr: "",
        stakeNote: ""
      }
    }
  };
}

export function normalizeSocialState(input: unknown): SocialStateV1 | null {
  if (!input || typeof input !== "object") return null;
  if ((input as any).version !== 1) return null;

  return {
    version: 1,
    aliases: normalizeAliases((input as any).aliases),
    trustedPubkeys: normalizePubkeyList((input as any).trustedPubkeys),
    mutedPubkeys: normalizePubkeyList((input as any).mutedPubkeys),
    blockedPubkeys: normalizePubkeyList((input as any).blockedPubkeys),
    favorites: normalizeFavorites((input as any).favorites),
    settings: normalizeSettings((input as any).settings)
  };
}

export function parseSocialState(raw: string | null | undefined): SocialStateV1 | null {
  const input = (raw ?? "").trim();
  if (!input) return null;
  try {
    return normalizeSocialState(JSON.parse(input));
  } catch {
    return null;
  }
}
