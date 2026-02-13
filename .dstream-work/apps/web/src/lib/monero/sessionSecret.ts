import crypto from "node:crypto";

let cachedSecret: string | null = null;

export function getXmrSessionSecret(): string {
  if (cachedSecret) return cachedSecret;

  const fromEnv = (process.env.DSTREAM_XMR_SESSION_SECRET ?? "").trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DSTREAM_XMR_SESSION_SECRET is required in production.");
  }

  cachedSecret = crypto.randomBytes(32).toString("hex");
  return cachedSecret;
}
