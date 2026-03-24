import { verifyAccessProof } from "@/lib/access/proof";
import { listAccessEntitlements } from "@/lib/access/store";
import { asString, normalizePubkey, parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PACKAGE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function getFirstTagValue(tags: unknown, name: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const rawTag of tags) {
    if (!Array.isArray(rawTag)) continue;
    if (rawTag[0] !== name) continue;
    if (typeof rawTag[1] !== "string") continue;
    const value = rawTag[1].trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function parseStatus(input: unknown): "active" | "revoked" | "expired" | "all" {
  const value = asString(input).toLowerCase();
  if (value === "active" || value === "revoked" || value === "expired" || value === "all") return value;
  return "active";
}

function includesWatchVod(actions: string[]): boolean {
  return actions.includes("watch_vod");
}

function parsePackageIdFromEntitlement(input: { metadata: Record<string, unknown>; sourceRef?: string }): string | undefined {
  const metadataPackageId = typeof input.metadata?.packageId === "string" ? input.metadata.packageId.trim() : "";
  if (metadataPackageId && PACKAGE_ID_RE.test(metadataPackageId)) return metadataPackageId;

  const sourceRef = typeof input.sourceRef === "string" ? input.sourceRef.trim() : "";
  if (!sourceRef) return undefined;
  const match = sourceRef.match(/^package:([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})(?::|$)/);
  if (!match) return undefined;
  return match[1];
}

function isBetterUnlockCandidate(
  candidate: { expiresAtSec?: number; updatedAtSec: number },
  existing: { expiresAtSec?: number; updatedAtSec: number }
): boolean {
  const candidateNoExpiry = typeof candidate.expiresAtSec !== "number";
  const existingNoExpiry = typeof existing.expiresAtSec !== "number";
  if (candidateNoExpiry && !existingNoExpiry) return true;
  if (!candidateNoExpiry && existingNoExpiry) return false;
  if (!candidateNoExpiry && !existingNoExpiry) {
    if ((candidate.expiresAtSec ?? 0) > (existing.expiresAtSec ?? 0)) return true;
    if ((candidate.expiresAtSec ?? 0) < (existing.expiresAtSec ?? 0)) return false;
  }
  return candidate.updatedAtSec > existing.updatedAtSec;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const hostPubkey = normalizePubkey(payload.hostPubkey);
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a 64-char hex pubkey" }, { status: 400 });

  const streamIdRaw = asString(payload.streamId);
  const streamId = streamIdRaw ? streamIdRaw : undefined;
  if (streamId && !STREAM_ID_RE.test(streamId)) {
    return Response.json({ ok: false, error: "streamId is invalid." }, { status: 400 });
  }

  const auth = verifyAccessProof(payload.viewerProofEvent, "access_viewer");
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const proofHostTagRaw = getFirstTagValue((payload.viewerProofEvent as { tags?: unknown } | undefined)?.tags, "host");
  const proofHostTag = proofHostTagRaw ? normalizePubkey(proofHostTagRaw) : null;
  if (proofHostTag && proofHostTag !== hostPubkey) {
    return Response.json({ ok: false, error: "Signed viewer proof host does not match requested host." }, { status: 403 });
  }

  const status = parseStatus(payload.status);
  const rows = listAccessEntitlements({
    hostPubkey,
    subjectPubkey: auth.pubkey,
    status,
    limit: parsePositiveInt(payload.limit) ?? 800
  });

  const resourcePrefix = streamId ? `stream:${hostPubkey}:${streamId}:vod` : `stream:${hostPubkey}:`;

  const unlocks = rows
    .filter((row) => {
      if (!includesWatchVod(row.actions)) return false;
      if (streamId) return row.resourceId.startsWith(resourcePrefix);
      return row.resourceId.startsWith(resourcePrefix) && row.resourceId.includes(":vod");
    })
    .map((row) => ({
      entitlementId: row.id,
      packageId: parsePackageIdFromEntitlement({ metadata: row.metadata, sourceRef: row.sourceRef }),
      resourceId: row.resourceId,
      status: row.status,
      source: row.source,
      sourceRef: row.sourceRef,
      startsAtSec: row.startsAtSec,
      expiresAtSec: row.expiresAtSec,
      updatedAtSec: row.updatedAtSec
    }))
    .sort((left, right) => right.updatedAtSec - left.updatedAtSec);

  const byPackageId: Record<
    string,
    {
      entitlementId: string;
      resourceId: string;
      status: string;
      source: string;
      sourceRef?: string;
      startsAtSec: number;
      expiresAtSec?: number;
      updatedAtSec: number;
    }
  > = {};

  for (const row of unlocks) {
    if (!row.packageId) continue;
    const existing = byPackageId[row.packageId];
    if (!existing || isBetterUnlockCandidate(row, existing)) {
      byPackageId[row.packageId] = {
        entitlementId: row.entitlementId,
        resourceId: row.resourceId,
        status: row.status,
        source: row.source,
        sourceRef: row.sourceRef,
        startsAtSec: row.startsAtSec,
        expiresAtSec: row.expiresAtSec,
        updatedAtSec: row.updatedAtSec
      };
    }
  }

  return Response.json({
    ok: true,
    hostPubkey,
    streamId: streamId ?? null,
    viewerPubkey: auth.pubkey,
    unlocks,
    byPackageId,
    count: unlocks.length
  });
}
