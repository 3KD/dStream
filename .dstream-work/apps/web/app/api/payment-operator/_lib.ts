import { timingSafeEqual } from "node:crypto";

function parseBearerToken(header: string | null): string {
  const match = (header ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function envFlagEnabled(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return false;
  return value !== "0" && value !== "false" && value !== "no" && value !== "off";
}

function envFlagDisabled(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "0" || value === "false" || value === "no" || value === "off";
}

function paymentOperatorBearerRequired(): boolean {
  const override = process.env.DSTREAM_PAYMENT_OPERATOR_REQUIRE_BEARER;
  if (envFlagEnabled(override)) return true;
  if (envFlagDisabled(override)) return false;
  const mode = (process.env.HARDEN_MODE ?? "").trim().toLowerCase();
  return process.env.NODE_ENV === "production" || mode === "prod" || mode === "production" || mode === "deploy" || mode === "external";
}

function secureTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizePaymentOperatorRequest(req: Request): Response | null {
  const expected = (process.env.DSTREAM_PAYMENT_OPERATOR_BEARER_TOKEN ?? "").trim();
  if (!expected) {
    if (!paymentOperatorBearerRequired()) return null;
    return Response.json({ ok: false, error: "Payment operator bearer token is not configured." }, { status: 503 });
  }
  const presented = parseBearerToken(req.headers.get("authorization"));
  if (presented && secureTokenEqual(presented, expected)) return null;
  return Response.json({ ok: false, error: "Unauthorized payment operator request." }, { status: 401 });
}
