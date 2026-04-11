import { listVideoAccessPackages, listVideoPackagePurchaseStats } from "@/lib/access/packages";
import { asString, authorizeAccessAdmin, normalizePubkey, parseBoolean, parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const hostPubkey = normalizePubkey(payload.hostPubkey);
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a valid 64-char hex pubkey" }, { status: 400 });

  const includeDisabledRequested = parseBoolean(payload.includeDisabled);
  const includeUnlistedRequested = parseBoolean(payload.includeUnlisted);
  const includePurchaseStatsRequested = parseBoolean(payload.includePurchaseStats);
  const streamId = asString(payload.streamId) || undefined;
  const limit = parsePositiveInt(payload.limit) ?? 200;
  const purchaseStatsLimit = parsePositiveInt(payload.purchaseStatsLimit) ?? 5000;

  let actorPubkey: string | null = null;
  let includeDisabled = false;
  let includeUnlisted = false;

  if (includeDisabledRequested || includeUnlistedRequested || includePurchaseStatsRequested || payload.operatorProofEvent) {
    const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
    if (!auth.ok && (includeDisabledRequested || includeUnlistedRequested || includePurchaseStatsRequested)) {
      return Response.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    if (auth.ok) {
      actorPubkey = auth.actorPubkey;
      includeDisabled = includeDisabledRequested;
      includeUnlisted = includeUnlistedRequested;
    }
  }

  const packages = listVideoAccessPackages({
    hostPubkey,
    streamId,
    includeDisabled,
    includeUnlisted,
    limit
  });
  const purchaseStatsByPackageId =
    includePurchaseStatsRequested && actorPubkey
      ? listVideoPackagePurchaseStats({
          hostPubkey,
          packageIds: packages.map((row) => row.id),
          limit: purchaseStatsLimit
        })
      : {};

  return Response.json({
    ok: true,
    hostPubkey,
    streamId: streamId ?? null,
    count: packages.length,
    packages,
    actorPubkey,
    purchaseStatsByPackageId
  });
}
