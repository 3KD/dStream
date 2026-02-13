export type NostrTag = string[];

export interface NostrEvent {
  id?: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: NostrTag[];
  content: string;
  sig?: string;
}

export const NOSTR_KINDS = {
  STREAM_ANNOUNCE: 30311,
  STREAM_CHAT: 1311,
  PRESENCE: 30312,
  P2P_SIGNAL: 8108,
  MANIFEST_ROOT: 30313,
  XMR_RECEIPT: 30314,
  GUILD: 30315,
  P2P_BYTES_RECEIPT: 30316,
  STREAM_MOD_ACTION: 30317,
  STREAM_MOD_ROLE: 30318,
  GUILD_MEMBERSHIP: 30319,
  GUILD_ROLE: 30320
} as const;

export type StreamStatus = "live" | "ended";
export type StreamHostMode = "p2p_economy" | "host_only";

export interface StreamCaptionTrack {
  lang: string;
  label: string;
  url: string;
  isDefault?: boolean;
}

export interface StreamRendition {
  id: string;
  url: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  codecs?: string;
}

export interface StreamAnnounce {
  pubkey: string;
  streamId: string;
  title: string;
  status: StreamStatus;
  summary?: string;
  image?: string;
  streaming?: string;
  xmr?: string;
  hostMode?: StreamHostMode;
  rebroadcastThreshold?: number;
  manifestSignerPubkey?: string;
  stakeAmountAtomic?: string;
  stakeNote?: string;
  captions: StreamCaptionTrack[];
  renditions: StreamRendition[];
  topics: string[];
  createdAt: number;
  raw: NostrEvent;
}

export interface ManifestSegment {
  uri: string;
  sha256: string;
  byteLength?: number;
}

export interface ManifestInitSegment {
  uri: string;
  sha256: string;
  byteLength?: number;
}

export interface StreamManifestRoot {
  pubkey: string; // manifest signer pubkey (Nostr pubkey)
  streamPubkey: string;
  streamId: string;
  renditionId: string;
  epochStartMs: number;
  epochDurationMs: number;
  segments: ManifestSegment[];
  init?: ManifestInitSegment;
  createdAt: number;
  raw: NostrEvent;
}

export interface XmrTipReceipt {
  pubkey: string; // receipt publisher (typically broadcaster)
  streamPubkey: string;
  streamId: string;
  amountAtomic: string;
  confirmed: boolean;
  observedAtMs: number;
  createdAt: number;
  raw: NostrEvent;
}

export interface P2PBytesReceipt {
  pubkey: string; // receipt publisher
  fromPubkey: string; // participant credited for served bytes
  streamPubkey: string;
  streamId: string;
  servedBytes: number;
  observedAtMs: number;
  sessionId?: string;
  createdAt: number;
  raw: NostrEvent;
}

export interface StreamChatMessage {
  id?: string;
  pubkey: string;
  streamPubkey: string;
  streamId: string;
  content: string;
  createdAt: number;
  raw: NostrEvent;
}

export interface StreamPresence {
  id?: string;
  pubkey: string;
  streamPubkey: string;
  streamId: string;
  createdAt: number;
  raw: NostrEvent;
}

export interface GuildFeaturedStreamRef {
  streamPubkey: string;
  streamId: string;
}

export interface Guild {
  pubkey: string;
  guildId: string;
  name: string;
  about?: string;
  image?: string;
  topics: string[];
  featuredStreams: GuildFeaturedStreamRef[];
  createdAt: number;
  raw: NostrEvent;
}

export type StreamModerationAction = "mute" | "block" | "clear";

export interface StreamModerationRecord {
  pubkey: string;
  streamPubkey: string;
  streamId: string;
  targetPubkey: string;
  action: StreamModerationAction;
  reason?: string;
  createdAt: number;
  raw: NostrEvent;
}

export type StreamModeratorRole = "moderator" | "subscriber" | "none";

export interface StreamModeratorRoleAssignment {
  pubkey: string;
  streamPubkey: string;
  streamId: string;
  targetPubkey: string;
  role: StreamModeratorRole;
  createdAt: number;
  raw: NostrEvent;
}

export type GuildMembershipStatus = "joined" | "left";

export interface GuildMembership {
  pubkey: string;
  guildPubkey: string;
  guildId: string;
  status: GuildMembershipStatus;
  createdAt: number;
  raw: NostrEvent;
}

export type GuildRole = "member" | "moderator" | "admin" | "none";

export interface GuildRoleAssignment {
  pubkey: string;
  guildPubkey: string;
  guildId: string;
  targetPubkey: string;
  role: GuildRole;
  createdAt: number;
  raw: NostrEvent;
}

export type P2PSignalType = "offer" | "answer" | "candidate" | "bye" | "ping" | "pong";

export interface P2PSignalPayloadV1 {
  v: 1;
  type: P2PSignalType;
  sessionId: string;
  streamPubkey: string;
  streamId: string;
  swarmId?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export interface P2PSignalEnvelope {
  id?: string;
  pubkey: string;
  recipientPubkey: string;
  streamPubkey: string;
  streamId: string;
  createdAt: number;
  content: string;
  raw: NostrEvent;
}
