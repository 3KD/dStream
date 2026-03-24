export const ACCESS_ACTIONS = ["watch_live", "watch_vod", "chat_send", "p2p_assist", "rebroadcast"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const ACCESS_ENTITLEMENT_SOURCES = [
  "owner_grant",
  "vip_waiver",
  "guild_waiver",
  "purchase_verified",
  "purchase_unverified",
  "manual_grant",
  "migration"
] as const;
export type AccessEntitlementSource = (typeof ACCESS_ENTITLEMENT_SOURCES)[number];

export const ACCESS_ENTITLEMENT_STATUS = ["active", "revoked", "expired"] as const;
export type AccessEntitlementStatus = (typeof ACCESS_ENTITLEMENT_STATUS)[number];

export interface AccessEntitlement {
  id: string;
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: string[];
  source: AccessEntitlementSource;
  sourceRef?: string;
  status: AccessEntitlementStatus;
  startsAtSec: number;
  expiresAtSec?: number;
  revokedAtSec?: number;
  revokeReason?: string;
  metadata: Record<string, unknown>;
  createdAtSec: number;
  updatedAtSec: number;
}

export interface AccessDenyRule {
  id: string;
  hostPubkey: string;
  subjectPubkey: string;
  resourceId: string;
  actions: string[];
  reason?: string;
  startsAtSec: number;
  expiresAtSec?: number;
  createdAtSec: number;
  updatedAtSec: number;
}

export interface AccessAuditRecord {
  id: string;
  atSec: number;
  hostPubkey: string;
  subjectPubkey?: string;
  resourceId: string;
  action: AccessAction;
  allowed: boolean;
  reasonCode: string;
  entitlementId?: string;
  requestId?: string;
  metadata: Record<string, unknown>;
}

export interface AccessPolicyContext {
  hostPubkey: string;
  streamId?: string;
  resourceId: string;
  action: AccessAction;
  subjectPubkey?: string;
  requestId?: string;
  nowSec?: number;
  skipAudit?: boolean;
  announce?: {
    privateStream: boolean;
    privateVod: boolean;
    vodArchiveEnabled: boolean;
    vodVisibility: "public" | "private";
    viewerAllowPubkeys: string[];
    feeWaiverVipPubkeys?: string[];
  };
}

export interface AccessDecision {
  allowed: boolean;
  reasonCode:
    | "deny_explicit"
    | "deny_identity_required"
    | "deny_private_allowlist"
    | "deny_vod_archive_disabled"
    | "deny_no_matching_entitlement"
    | "allow_owner"
    | "allow_operator"
    | "allow_vip_waiver"
    | "allow_allowlist"
    | "allow_paid"
    | "allow_public";
  entitlementId?: string;
  expiresAtSec?: number;
}
