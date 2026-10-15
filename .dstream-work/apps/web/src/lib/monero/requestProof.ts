import { createHash } from "node:crypto";

export async function verifyWalletRequestPayload(req: Request, tags: string[][]): Promise<boolean> {
  const payloadTags = tags.filter((tag) => tag[0] === "payload");
  if (payloadTags.length !== 1) return false;
  const digest = createHash("sha256").update(await req.clone().text()).digest("hex");
  return payloadTags[0]?.[1] === digest;
}
