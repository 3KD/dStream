import { NativePaymentVerificationError } from "./types";

function getTimeoutMs(): number {
  const parsed = Number.parseInt((process.env.DSTREAM_PAYMENT_RPC_TIMEOUT_MS ?? "8000").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 30000 ? parsed : 8000;
}

export async function postJson<T>(input: {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  label: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.headers ?? {})
      },
      body: JSON.stringify(input.body),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new NativePaymentVerificationError(`${input.label} returned HTTP ${response.status}.`, 502);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof NativePaymentVerificationError) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : "failed";
    throw new NativePaymentVerificationError(`${input.label} ${detail}.`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJson<T>(input: {
  url: string;
  headers?: Record<string, string>;
  label: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(input.url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(input.headers ?? {})
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new NativePaymentVerificationError(`${input.label} returned HTTP ${response.status}.`, 502);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof NativePaymentVerificationError) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : "failed";
    throw new NativePaymentVerificationError(`${input.label} ${detail}.`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getText(input: {
  url: string;
  headers?: Record<string, string>;
  label: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(input.url, {
      method: "GET",
      headers: input.headers,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new NativePaymentVerificationError(`${input.label} returned HTTP ${response.status}.`, 502);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof NativePaymentVerificationError) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : "failed";
    throw new NativePaymentVerificationError(`${input.label} ${detail}.`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function joinOriginPath(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
