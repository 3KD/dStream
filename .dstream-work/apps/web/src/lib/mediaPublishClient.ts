import type { NostrEvent } from "@dstream/protocol";
import { sha256Text } from "./encoding";

export async function requestPublishCredential(
  originStreamId: string,
  signEvent: (event: Omit<NostrEvent, "id" | "sig">) => Promise<NostrEvent>,
  pubkey: string
): Promise<{ token: string; expiresAt: number }> {
  const route = "/api/broadcast/publish-credential";
  const body = JSON.stringify({ originStreamId, streamId: originStreamId.slice(66) });
  const event = await signEvent({ kind: 27235, pubkey, created_at: Math.floor(Date.now() / 1000), content: "",
    tags: [["u", new URL(route, window.location.origin).href], ["method", "POST"], ["payload", await sha256Text(body)]] });
  const response = await fetch(route, { method: "POST", headers: { "content-type": "application/json",
    authorization: `Nostr ${btoa(JSON.stringify(event))}` }, body, cache: "no-store" });
  if (!response.ok) throw new Error("Secure publish credentials could not be issued.");
  return response.json();
}
