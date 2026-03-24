import type { VodAccessPackage } from "./packages";

const DEFAULT_VERIFY_TIMEOUT_MS = 12_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseTimeoutMs(): number {
  const raw = Number((process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_TIMEOUT_MS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_VERIFY_TIMEOUT_MS;
  return Math.max(500, Math.min(Math.trunc(raw), 60_000));
}

function buildVerifierUrl(): string {
  return (process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_URL ?? "").trim();
}

function buildVerifierSecret(): string {
  return (process.env.DSTREAM_ACCESS_PURCHASE_VERIFY_SECRET ?? "").trim();
}

async function parseVerifierError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      const message = asString((body as { error?: unknown }).error);
      if (message) return message;
    }
  } catch {
    // ignore json parse failure
  }
  try {
    const text = (await response.text()).trim();
    if (text) return text.slice(0, 500);
  } catch {
    // ignore text parse failure
  }
  return `verification failed (${response.status})`;
}

export interface ExternalPurchaseVerificationInput {
  package: VodAccessPackage;
  buyerPubkey: string;
  buyerProofEvent: unknown;
  sourceRef?: string;
  settlementRef?: string;
  paymentProof?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ExternalPurchaseVerificationResult {
  supported: boolean;
  verified: boolean;
  status: number;
  error?: string;
  sourceRef?: string;
  settlementRef?: string;
  metadata?: Record<string, unknown>;
}

export function hasExternalPurchaseVerifier(): boolean {
  return !!buildVerifierUrl();
}

export async function verifyExternalPurchase(input: ExternalPurchaseVerificationInput): Promise<ExternalPurchaseVerificationResult> {
  const url = buildVerifierUrl();
  if (!url) {
    return {
      supported: false,
      verified: false,
      status: 200
    };
  }

  const timeoutMs = parseTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const secret = buildVerifierSecret();
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (secret) headers.authorization = `Bearer ${secret}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        package: {
          id: input.package.id,
          hostPubkey: input.package.hostPubkey,
          streamId: input.package.streamId,
          playlistId: input.package.playlistId,
          relativePath: input.package.relativePath,
          resourceId: input.package.resourceId,
          paymentAsset: input.package.paymentAsset,
          paymentAmount: input.package.paymentAmount,
          paymentRailId: input.package.paymentRailId,
          durationHours: input.package.durationHours
        },
        buyerPubkey: input.buyerPubkey,
        buyerProofEvent: input.buyerProofEvent,
        sourceRef: input.sourceRef,
        settlementRef: input.settlementRef,
        paymentProof: input.paymentProof,
        metadata: input.metadata ?? {}
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        supported: true,
        verified: false,
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
        error: await parseVerifierError(response)
      };
    }

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: unknown;
          verified?: unknown;
          sourceRef?: unknown;
          settlementRef?: unknown;
          metadata?: unknown;
          error?: unknown;
        }
      | null;

    const bodyOk = body?.ok === true || body?.ok === undefined;
    const verified = body?.verified === true;
    if (!bodyOk || !verified) {
      const message = asString(body?.error) || "payment verification did not confirm settlement";
      return {
        supported: true,
        verified: false,
        status: 402,
        error: message
      };
    }

    return {
      supported: true,
      verified: true,
      status: 200,
      sourceRef: asString(body?.sourceRef) || undefined,
      settlementRef: asString(body?.settlementRef) || undefined,
      metadata: sanitizeMetadata(body?.metadata)
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return {
        supported: true,
        verified: false,
        status: 504,
        error: `payment verification timeout (${timeoutMs}ms)`
      };
    }
    return {
      supported: true,
      verified: false,
      status: 502,
      error: `payment verification request failed (${error?.message ?? "unknown error"})`
    };
  } finally {
    clearTimeout(timeout);
  }
}
