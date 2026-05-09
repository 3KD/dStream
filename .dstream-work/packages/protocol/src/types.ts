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
  GUILD_ROLE: 30320,
  APP_DISCOVERY_MOD: 30321,
  CUSTOM_EMOJI: 10030,
  REPORT: 1984
} as const;

export type StreamStatus = "live" | "ended";
export type StreamHostMode = "p2p_economy" | "host_only";
export type StreamVideoVisibility = "public" | "private";
export type StreamVideoMode = "off" | "public" | "paid";
export type StreamVideoAccessScope = "stream" | "playlist";
export const STREAM_PAYMENT_ASSETS = ["xmr", "eth", "btc", "usdt", "xrp", "usdc", "sol", "trx", "doge", "bch", "ada", "pepe"] as const;
export type StreamPaymentAsset = (typeof STREAM_PAYMENT_ASSETS)[number];
export const PAYMENT_RAIL_IDS = ["xmr", "lightning", "utxo", "evm", "tron", "solana", "xrpl", "cardano"] as const;
export type PaymentRailId = (typeof PAYMENT_RAIL_IDS)[number];

export interface StreamVideoPolicy {
  mode: StreamVideoMode;
  priceAtomic?: string;
  currency?: string;
  accessSeconds?: number;
  playlistId?: string;
  accessScope?: StreamVideoAccessScope;
}

export interface StreamPaymentMethod {
  asset: StreamPaymentAsset;
  address: string;
  network?: string;
  label?: string;
  amount?: string;
}

export interface PaymentSettlementProof {
  version: 1;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  proofType: string;
  settlementRef?: string;
  txRef?: string;
  network?: string;
  amount?: string;
  amountAtomic?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PaymentSettlementTarget {
  version: 1;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  destination: string;
  network?: string;
  label?: string;
  reference?: string;
  contractAddress?: string;
  amount?: string;
  amountAtomic?: string;
  metadata?: Record<string, unknown>;
}

export interface VerifiedPaymentSettlement {
  version: 1;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  settlementKind: string;
  settlementRef: string;
  txRef?: string;
  network?: string;
  amount?: string;
  amountAtomic?: string;
  confirmed: boolean;
  observedAtMs: number;
  verifier: "host_origin" | "external_verifier" | "operator_override";
  metadata?: Record<string, unknown>;
}

export const PAYMENT_SESSION_STATUSES = [
  "created",
  "awaiting_payment",
  "pending_operator",
  "observed",
  "verified",
  "granted",
  "expired",
  "failed",
  "cancelled"
] as const;
export type PaymentSessionStatus = (typeof PAYMENT_SESSION_STATUSES)[number];

export const PAYMENT_SESSION_PROOF_MODES = [
  "none",
  "operator_observed",
  "client_tx_ref",
  "client_settlement_proof"
] as const;
export type PaymentSessionProofMode = (typeof PAYMENT_SESSION_PROOF_MODES)[number];

export interface PaymentSessionOperatorDescriptor {
  authority: "node_operator" | "embedded_reference";
  transport: "http" | "embedded";
  label?: string;
  endpoint?: string;
}

export interface PaymentSessionTarget {
  version: 1;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  targetType: "address" | "invoice" | "uri";
  destination: string;
  network?: string;
  label?: string;
  reference?: string;
  contractAddress?: string;
  amount?: string;
  amountAtomic?: string;
  walletUri?: string;
  qrValue?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSessionRecord {
  version: 1;
  id: string;
  packageId: string;
  hostPubkey: string;
  streamId: string;
  viewerPubkey: string;
  railId: PaymentRailId;
  asset: StreamPaymentAsset;
  status: PaymentSessionStatus;
  proofMode: PaymentSessionProofMode;
  operator: PaymentSessionOperatorDescriptor;
  target: PaymentSessionTarget;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs?: number;
  sourceRef?: string;
  settlement?: VerifiedPaymentSettlement;
  entitlementId?: string;
  purchaseId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSessionPackageDescriptor {
  id: string;
  hostPubkey: string;
  streamId: string;
  paymentAsset: StreamPaymentAsset;
  paymentAmount: string;
  paymentRailId?: PaymentRailId;
  paymentTarget?: PaymentSettlementTarget;
}

export interface PaymentSessionViewerDescriptor {
  pubkey: string;
}

export interface PaymentOperatorSessionCreateRequest {
  version: 1;
  sessionId: string;
  package: PaymentSessionPackageDescriptor;
  viewer: PaymentSessionViewerDescriptor;
  metadata?: Record<string, unknown>;
}

export interface PaymentOperatorSessionStatusRequest {
  version: 1;
  sessionId: string;
  packageId: string;
  viewerPubkey: string;
}

export interface PaymentOperatorSessionObserveRequest extends PaymentOperatorSessionStatusRequest {
  txRef?: string;
  settlementProof?: PaymentSettlementProof;
  paymentProof?: PaymentSettlementProof;
  metadata?: Record<string, unknown>;
}

export interface PaymentOperatorSessionSuccessResponse {
  ok: true;
  status?: PaymentSessionStatus;
  proofMode?: PaymentSessionProofMode;
  operatorLabel?: string;
  target?: PaymentSessionTarget;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
  settlement?: VerifiedPaymentSettlement;
  error?: string;
}

export interface PaymentOperatorSessionErrorResponse {
  ok: false;
  error: string;
  status?: PaymentSessionStatus;
  proofMode?: PaymentSessionProofMode;
  operatorLabel?: string;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
}

export interface PaymentOperatorSessionCreateSuccessResponse extends PaymentOperatorSessionSuccessResponse {
  target: PaymentSessionTarget;
}

export type PaymentOperatorSessionCreateResponse =
  | PaymentOperatorSessionCreateSuccessResponse
  | PaymentOperatorSessionErrorResponse;
export type PaymentOperatorSessionStatusResponse = PaymentOperatorSessionSuccessResponse | PaymentOperatorSessionErrorResponse;
export type PaymentOperatorSessionObserveResponse = PaymentOperatorSessionSuccessResponse | PaymentOperatorSessionErrorResponse;

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

export interface StreamGuildFeeWaiver {
  guildPubkey: string;
  guildId: string;
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
  streamChatSlowModeSec?: number;
  streamChatSubscriberOnly?: boolean;
  streamChatFollowerOnly?: boolean;
  discoverable: boolean;
  matureContent: boolean;
  contentWarningReason?: string;
  viewerAllowPubkeys: string[];
  videoArchiveEnabled?: boolean;
  videoVisibility: StreamVideoVisibility;
  video?: StreamVideoPolicy;
  feeWaiverGuilds: StreamGuildFeeWaiver[];
  feeWaiverVipPubkeys: string[];
  manifestSignerPubkey?: string;
  stakeAmountAtomic?: string;
  stakeNote?: string;
  payments: StreamPaymentMethod[];
  captions: StreamCaptionTrack[];
  renditions: StreamRendition[];
  topics: string[];
  currentParticipants?: number;
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
  emojis?: { shortcode: string; url: string; hash?: string }[];
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

export type DiscoveryModerationAction = "hide" | "show";
export type DiscoveryModerationTargetType = "pubkey" | "stream";

export interface DiscoveryModerationRecord {
  pubkey: string;
  action: DiscoveryModerationAction;
  targetType: DiscoveryModerationTargetType;
  targetPubkey: string;
  targetStreamId?: string;
  reason?: string;
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
