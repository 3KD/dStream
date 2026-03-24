import { appendAccessAuditRecord, listAccessDenyRules, listAccessEntitlements } from "./store";
import type { AccessAction, AccessDecision, AccessPolicyContext } from "./types";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizePubkeyHex(input: string | null | undefined): string | null {
  const value = (input ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function sanitizeResourceId(input: string | null | undefined): string {
  return (input ?? "").trim().slice(0, 400);
}

function readOperatorPubkeys(): string[] {
  const raw = (process.env.DSTREAM_ACCESS_OPERATOR_PUBKEYS ?? process.env.NEXT_PUBLIC_DISCOVERY_OPERATOR_PUBKEYS ?? "").trim();
  if (!raw) return [];
  const set = new Set<string>();
  for (const part of raw.split(/[\n,]+/g)) {
    const normalized = normalizePubkeyHex(part);
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

function matchesResource(scope: string, requested: string): boolean {
  const normalizedScope = scope.trim();
  const normalizedRequested = requested.trim();
  if (!normalizedScope || !normalizedRequested) return false;
  if (normalizedScope === "*") return true;
  if (normalizedScope === normalizedRequested) return true;
  if (normalizedScope.endsWith("*")) {
    const prefix = normalizedScope.slice(0, -1);
    return !!prefix && normalizedRequested.startsWith(prefix);
  }
  return false;
}

function matchesAction(actions: string[], action: AccessAction): boolean {
  if (actions.includes("*")) return true;
  return actions.includes(action);
}

function allow(result: Omit<AccessDecision, "allowed">): AccessDecision {
  return { allowed: true, ...result };
}

function deny(result: Omit<AccessDecision, "allowed">): AccessDecision {
  return { allowed: false, ...result };
}

function isLivePublicAllowed(context: AccessPolicyContext): boolean {
  const announce = context.announce;
  if (!announce) return true;
  return !announce.privateStream;
}

function isVodAllowedByPolicy(context: AccessPolicyContext): AccessDecision | null {
  const announce = context.announce;
  if (!announce) return allow({ reasonCode: "allow_public" });
  if (!announce.vodArchiveEnabled) return deny({ reasonCode: "deny_vod_archive_disabled" });
  if (announce.vodVisibility !== "private") return allow({ reasonCode: "allow_public" });
  return null;
}

function isVipWaived(context: AccessPolicyContext, subjectPubkey: string): boolean {
  const announce = context.announce;
  if (!announce) return false;
  const vipList = Array.isArray(announce.feeWaiverVipPubkeys) ? announce.feeWaiverVipPubkeys : [];
  return vipList.includes(subjectPubkey);
}

function recordAudit(context: AccessPolicyContext, input: Parameters<typeof appendAccessAuditRecord>[0]): void {
  if (context.skipAudit) return;
  try {
    appendAccessAuditRecord(input);
  } catch {
    // ignore audit write failures in access path
  }
}

export function evaluateAccess(contextInput: AccessPolicyContext): AccessDecision {
  const currentNow = contextInput.nowSec ?? nowSec();
  const hostPubkey = normalizePubkeyHex(contextInput.hostPubkey);
  const subjectPubkey = normalizePubkeyHex(contextInput.subjectPubkey);
  const resourceId = sanitizeResourceId(contextInput.resourceId);
  const action = contextInput.action;

  if (!hostPubkey || !resourceId) {
    return deny({ reasonCode: "deny_no_matching_entitlement" });
  }

  if (action === "watch_vod" && contextInput.announce && !contextInput.announce.vodArchiveEnabled) {
    const result = deny({ reasonCode: "deny_vod_archive_disabled" });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey: subjectPubkey ?? undefined,
      resourceId,
      action,
      allowed: false,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  if (!subjectPubkey) {
    if (action === "watch_live") {
      return isLivePublicAllowed(contextInput) ? allow({ reasonCode: "allow_public" }) : deny({ reasonCode: "deny_identity_required" });
    }
    if (action === "watch_vod") {
      const vodDecision = isVodAllowedByPolicy(contextInput);
      if (vodDecision) return vodDecision;
      return deny({ reasonCode: "deny_identity_required" });
    }
  }

  if (subjectPubkey) {
    const denyRules = listAccessDenyRules({
      hostPubkey,
      subjectPubkey,
      limit: 1000
    });
    const denyMatch = denyRules.find((row) => matchesResource(row.resourceId, resourceId) && matchesAction(row.actions, action));
    if (denyMatch) {
      const result = deny({ reasonCode: "deny_explicit" });
      recordAudit(contextInput, {
        hostPubkey,
        subjectPubkey,
        resourceId,
        action,
        allowed: false,
        reasonCode: result.reasonCode,
        requestId: contextInput.requestId,
        metadata: { denyRuleId: denyMatch.id }
      });
      return result;
    }
  }

  if (subjectPubkey === hostPubkey) {
    const result = allow({ reasonCode: "allow_owner" });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey,
      resourceId,
      action,
      allowed: true,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  const operatorPubkeys = readOperatorPubkeys();
  if (subjectPubkey && operatorPubkeys.includes(subjectPubkey)) {
    const result = allow({ reasonCode: "allow_operator" });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey,
      resourceId,
      action,
      allowed: true,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  if (subjectPubkey && (action === "p2p_assist" || action === "rebroadcast") && isVipWaived(contextInput, subjectPubkey)) {
    const result = allow({ reasonCode: "allow_vip_waiver" });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey,
      resourceId,
      action,
      allowed: true,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  if (subjectPubkey && contextInput.announce?.viewerAllowPubkeys?.includes(subjectPubkey)) {
    const result = allow({ reasonCode: "allow_allowlist" });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey,
      resourceId,
      action,
      allowed: true,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  if (subjectPubkey) {
    const entitlements = listAccessEntitlements({
      hostPubkey,
      subjectPubkey,
      status: "active",
      limit: 2000
    });
    const entitlementMatch = entitlements.find((row) => {
      if (row.startsAtSec > currentNow) return false;
      if (row.expiresAtSec && row.expiresAtSec <= currentNow) return false;
      if (!matchesResource(row.resourceId, resourceId)) return false;
      return matchesAction(row.actions, action);
    });
    if (entitlementMatch) {
      const result = allow({
        reasonCode: "allow_paid",
        entitlementId: entitlementMatch.id,
        expiresAtSec: entitlementMatch.expiresAtSec
      });
      recordAudit(contextInput, {
        hostPubkey,
        subjectPubkey,
        resourceId,
        action,
        allowed: true,
        reasonCode: result.reasonCode,
        entitlementId: entitlementMatch.id,
        requestId: contextInput.requestId
      });
      return result;
    }
  }

  if (action === "watch_live") {
    if (isLivePublicAllowed(contextInput)) {
      const result = allow({ reasonCode: "allow_public" });
      recordAudit(contextInput, {
        hostPubkey,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId,
        action,
        allowed: true,
        reasonCode: result.reasonCode,
        requestId: contextInput.requestId
      });
      return result;
    }
    const result = deny({
      reasonCode: subjectPubkey ? "deny_private_allowlist" : "deny_identity_required"
    });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey: subjectPubkey ?? undefined,
      resourceId,
      action,
      allowed: false,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  if (action === "watch_vod") {
    const vodDecision = isVodAllowedByPolicy(contextInput);
    if (vodDecision?.allowed) {
      recordAudit(contextInput, {
        hostPubkey,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId,
        action,
        allowed: true,
        reasonCode: vodDecision.reasonCode,
        requestId: contextInput.requestId
      });
      return vodDecision;
    }
    if (vodDecision && !vodDecision.allowed) {
      recordAudit(contextInput, {
        hostPubkey,
        subjectPubkey: subjectPubkey ?? undefined,
        resourceId,
        action,
        allowed: false,
        reasonCode: vodDecision.reasonCode,
        requestId: contextInput.requestId
      });
      return vodDecision;
    }
    const result = deny({
      reasonCode: subjectPubkey ? "deny_private_allowlist" : "deny_identity_required"
    });
    recordAudit(contextInput, {
      hostPubkey,
      subjectPubkey: subjectPubkey ?? undefined,
      resourceId,
      action,
      allowed: false,
      reasonCode: result.reasonCode,
      requestId: contextInput.requestId
    });
    return result;
  }

  const result = deny({
    reasonCode: subjectPubkey ? "deny_no_matching_entitlement" : "deny_identity_required"
  });
  recordAudit(contextInput, {
    hostPubkey,
    subjectPubkey: subjectPubkey ?? undefined,
    resourceId,
    action,
    allowed: false,
    reasonCode: result.reasonCode,
    requestId: contextInput.requestId
  });
  return result;
}
