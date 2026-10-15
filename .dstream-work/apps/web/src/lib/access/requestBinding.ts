import { createHash } from "node:crypto";
import { updateJsonFileAtomic } from "../storage/jsonFileStore";
import type { NostrEvent } from "@dstream/protocol";

export function authorizeAdminRequest(event: NostrEvent, request: Request, payload: Record<string, unknown>, bodyDigest?: string): boolean {
  const value = (name: string) => {
    const rows = event.tags.filter((tag) => tag[0] === name);
    return rows.length === 1 ? rows[0]?.[1] : undefined;
  };
  const body = { ...payload };
  delete body.operatorProofEvent;
  const hash = bodyDigest ?? createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  if (value("u") !== request.url || value("method") !== request.method || value("payload") !== hash ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(value("nonce") ?? "") || Math.abs(event.created_at - now) > 60) return false;
  const path = process.env.DSTREAM_ACCESS_NONCE_STORE_PATH?.trim() || "/var/lib/dstream/access-request-nonces.json";
  let accepted = false;
  updateJsonFileAtomic<Record<string, number>>(path, {}, (seen) => {
    if (!seen || typeof seen !== "object" || Array.isArray(seen)) throw new Error("Invalid request nonce store.");
    for (const [id, expiry] of Object.entries(seen)) if (expiry <= now) delete seen[id];
    const id = event.id;
    if (!id || seen[id] || Object.keys(seen).length >= 10000) return seen;
    seen[id] = now + 120;
    accepted = true;
    return seen;
  });
  return accepted;
}
