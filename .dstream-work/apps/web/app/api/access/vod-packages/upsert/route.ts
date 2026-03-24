import { upsertVodAccessPackage, type VodAccessPackageStatus, type VodAccessPackageVisibility } from "@/lib/access/packages";
import type { StreamPaymentAsset } from "@dstream/protocol";
import { asString, authorizeAccessAdmin, normalizePubkey, parsePositiveInt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatus(input: unknown): VodAccessPackageStatus {
  const value = asString(input).toLowerCase();
  return value === "disabled" ? "disabled" : "active";
}

function parseVisibility(input: unknown): VodAccessPackageVisibility {
  const value = asString(input).toLowerCase();
  return value === "unlisted" ? "unlisted" : "public";
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
  if (!hostPubkey) return Response.json({ ok: false, error: "hostPubkey must be a valid 64-char hex pubkey" }, { status: 400 });

  const auth = authorizeAccessAdmin(payload.operatorProofEvent, hostPubkey);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const streamId = asString(payload.streamId);
  const title = asString(payload.title);
  const paymentAsset = asString(payload.paymentAsset).toLowerCase();
  const paymentAmount = asString(payload.paymentAmount);
  const durationHours = parsePositiveInt(payload.durationHours);
  if (!streamId) return Response.json({ ok: false, error: "streamId is required" }, { status: 400 });
  if (!title) return Response.json({ ok: false, error: "title is required" }, { status: 400 });
  if (!paymentAsset) return Response.json({ ok: false, error: "paymentAsset is required" }, { status: 400 });
  if (!paymentAmount) return Response.json({ ok: false, error: "paymentAmount is required" }, { status: 400 });
  if (!durationHours) return Response.json({ ok: false, error: "durationHours must be a positive integer" }, { status: 400 });

  try {
    const pkg = upsertVodAccessPackage({
      packageId: asString(payload.packageId) || undefined,
      hostPubkey,
      streamId,
      playlistId: asString(payload.playlistId) || undefined,
      relativePath: asString(payload.relativePath) || undefined,
      title,
      description: asString(payload.description) || undefined,
      paymentAsset: paymentAsset as StreamPaymentAsset,
      paymentAmount,
      paymentRailId: asString(payload.paymentRailId) || undefined,
      durationHours,
      status: parseStatus(payload.status),
      visibility: parseVisibility(payload.visibility),
      metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? (payload.metadata as Record<string, unknown>) : {}
    });
    return Response.json({ ok: true, package: pkg, actorPubkey: auth.actorPubkey });
  } catch (error: any) {
    return Response.json({ ok: false, error: error?.message ?? "failed to upsert VOD package" }, { status: 400 });
  }
}
