import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { buildStreamAnnounceEvent, type NostrEvent } from "@dstream/protocol";
import { makeOriginStreamId } from "./origin";
import { POST as issuePlaybackAccess } from "../../app/api/playback-access/issue/route";
import { GET as getHls } from "../../app/api/hls/[...path]/route";
import { PATCH as patchWhep, POST as postWhep } from "../../app/api/whep/[...path]/route";

const tempDir = mkdtempSync(join(tmpdir(), "dstream-private-playback-"));
const policyStorePath = join(tempDir, "playback-policies.json");
process.env.DSTREAM_PLAYBACK_POLICY_STORE_PATH = policyStorePath;
process.env.DSTREAM_PLAYBACK_ACCESS_SECRET = "test-playback-access-secret-0123456789abcdef";

after(() => rmSync(tempDir, { recursive: true, force: true }));

function signedAnnounce(input: {
  secret: Uint8Array;
  streamId: string;
  streamVisibility: "public" | "private";
  viewerAllowPubkeys?: string[];
}): NostrEvent {
  const pubkey = getPublicKey(input.secret);
  return finalizeEvent(
    buildStreamAnnounceEvent({
      pubkey,
      createdAt: Math.floor(Date.now() / 1000),
      streamId: input.streamId,
      title: "Synthetic private media",
      status: "live",
      streamVisibility: input.streamVisibility,
      viewerAllowPubkeys: input.viewerAllowPubkeys ?? [],
      streaming: `/api/hls/${pubkey}--${input.streamId}/index.m3u8`
    }) as any,
    input.secret
  ) as NostrEvent;
}

function signedViewerProof(secret: Uint8Array, originStreamId: string): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    {
      kind: 27235,
      created_at: now,
      tags: [
        ["dstream", "watch_access"],
        ["stream", originStreamId],
        ["exp", String(now + 300)]
      ],
      content: ""
    },
    secret
  ) as NostrEvent;
}

async function issue(input: {
  announceEvent: NostrEvent;
  originStreamId: string;
  viewerProofEvent?: NostrEvent;
}): Promise<Response> {
  return issuePlaybackAccess(
    new Request("http://dstream.test/api/playback-access/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    })
  );
}

function playbackCookie(token: string): string {
  return `dstream_playback_access=${encodeURIComponent(token)}`;
}

test("media routes: owner-only privacy blocks Incognito and authorizes owner HLS/WHEP subrequests", async () => {
  const ownerSecret = generateSecretKey();
  const outsiderSecret = generateSecretKey();
  const ownerPubkey = getPublicKey(ownerSecret);
  const streamId = "owner-only-routes";
  const originStreamId = makeOriginStreamId(ownerPubkey, streamId);
  assert.ok(originStreamId);
  if (!originStreamId) return;
  const announceEvent = signedAnnounce({ secret: ownerSecret, streamId, streamVisibility: "private" });

  const anonymousIssue = await issue({ announceEvent, originStreamId });
  assert.equal(anonymousIssue.status, 401);

  const outsiderIssue = await issue({
    announceEvent,
    originStreamId,
    viewerProofEvent: signedViewerProof(outsiderSecret, originStreamId)
  });
  assert.equal(outsiderIssue.status, 403);

  const ownerIssue = await issue({
    announceEvent,
    originStreamId,
    viewerProofEvent: signedViewerProof(ownerSecret, originStreamId)
  });
  assert.equal(ownerIssue.status, 200);
  const ownerPayload = (await ownerIssue.json()) as { token?: string; expiresAtSec?: number; reasonCode?: string };
  assert.equal(ownerPayload.reasonCode, "allow_owner");
  assert.ok(ownerPayload.token);
  assert.ok((ownerPayload.expiresAtSec ?? 0) >= Math.floor(Date.now() / 1000) + 35 * 60 * 60);
  if (!ownerPayload.token) return;

  const setCookie = ownerIssue.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`Path=/api/hls/${originStreamId}`));
  assert.match(setCookie, new RegExp(`Path=/api/whep/${originStreamId}`));
  assert.match(setCookie, new RegExp(`Path=/api/video/file/${originStreamId}`));

  const persisted = JSON.parse(readFileSync(policyStorePath, "utf8")) as { policies?: Array<{ privateStream?: boolean }> };
  assert.equal(persisted.policies?.[0]?.privateStream, true);

  const playbackAccessModuleUrl = new URL("./playback-access.ts", import.meta.url).href;
  const childOutput = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `const loaded = await import(${JSON.stringify(playbackAccessModuleUrl)}); const api = loaded.default ?? loaded; process.stdout.write(JSON.stringify(api.authorizePlaybackProxyRequest(${JSON.stringify([originStreamId, "index.m3u8"])}, null)));`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DSTREAM_PLAYBACK_POLICY_STORE_PATH: policyStorePath,
        DSTREAM_PLAYBACK_ACCESS_SECRET: "test-playback-access-secret-0123456789abcdef",
        TSX_TSCONFIG_PATH: join(process.cwd(), "apps/web/tsconfig.json")
      }
    }
  );
  assert.deepEqual(JSON.parse(childOutput), {
    ok: false,
    status: 403,
    error: "Playback access denied: identity is required."
  });

  const upstreamRequests: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    upstreamRequests.push({ url, method });
    if (url.includes("/whep")) {
      if (method === "POST") {
        return new Response("synthetic-sdp-answer", {
          status: 201,
          headers: { location: `/${originStreamId}/whep/session-1`, "content-type": "application/sdp" }
        });
      }
      return new Response(null, { status: 204 });
    }
    if (url.endsWith(".m3u8")) {
      return new Response("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment0001.ts\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" }
      });
    }
    return new Response(new Uint8Array([0x47, 0x40, 0x00, 0x10]), {
      status: 200,
      headers: { "content-type": "video/mp2t" }
    });
  }) as typeof fetch;

  try {
    const anonymousManifest = await getHls(
      new NextRequest(`http://dstream.test/api/hls/${originStreamId}/index.m3u8`),
      { params: Promise.resolve({ path: [originStreamId, "index.m3u8"] }) }
    );
    assert.equal(anonymousManifest.status, 403);
    assert.equal(upstreamRequests.length, 0);

    const ownerManifest = await getHls(
      new NextRequest(`http://dstream.test/api/hls/${originStreamId}/index.m3u8?access=${encodeURIComponent(ownerPayload.token)}`),
      { params: Promise.resolve({ path: [originStreamId, "index.m3u8"] }) }
    );
    assert.equal(ownerManifest.status, 200);
    assert.match(await ownerManifest.text(), /segment0001\.ts/);

    const ownerSegment = await getHls(
      new NextRequest(`http://dstream.test/api/hls/${originStreamId}/segment0001.ts`, {
        headers: { cookie: playbackCookie(ownerPayload.token) }
      }),
      { params: Promise.resolve({ path: [originStreamId, "segment0001.ts"] }) }
    );
    assert.equal(ownerSegment.status, 200);
    assert.equal((await ownerSegment.arrayBuffer()).byteLength, 4);

    const anonymousWhep = await postWhep(
      new NextRequest(`http://dstream.test/api/whep/${originStreamId}/whep`, {
        method: "POST",
        body: "synthetic-sdp-offer",
        headers: { "content-type": "application/sdp" }
      }),
      { params: Promise.resolve({ path: [originStreamId, "whep"] }) }
    );
    assert.equal(anonymousWhep.status, 403);

    const ownerWhep = await postWhep(
      new NextRequest(`http://dstream.test/api/whep/${originStreamId}/whep`, {
        method: "POST",
        body: "synthetic-sdp-offer",
        headers: { "content-type": "application/sdp", cookie: playbackCookie(ownerPayload.token) }
      }),
      { params: Promise.resolve({ path: [originStreamId, "whep"] }) }
    );
    assert.equal(ownerWhep.status, 201);
    const sessionLocation = ownerWhep.headers.get("location");
    assert.equal(sessionLocation, `/api/whep/${originStreamId}/whep/session-1`);

    const ownerWhepPatch = await patchWhep(
      new NextRequest(`http://dstream.test${sessionLocation}`, {
        method: "PATCH",
        body: "synthetic-ice-fragment",
        headers: { "content-type": "application/trickle-ice-sdpfrag", cookie: playbackCookie(ownerPayload.token) }
      }),
      { params: Promise.resolve({ path: [originStreamId, "whep", "session-1"] }) }
    );
    assert.equal(ownerWhepPatch.status, 204);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("media routes: public and multi-viewer behavior remain intact", async () => {
  const ownerSecret = generateSecretKey();
  const viewerSecret = generateSecretKey();
  const ownerPubkey = getPublicKey(ownerSecret);
  const viewerPubkey = getPublicKey(viewerSecret);

  const publicStreamId = "public-routes";
  const publicOriginStreamId = makeOriginStreamId(ownerPubkey, publicStreamId);
  assert.ok(publicOriginStreamId);
  if (!publicOriginStreamId) return;
  const publicAnnounce = signedAnnounce({ secret: ownerSecret, streamId: publicStreamId, streamVisibility: "public" });
  const publicIssue = await issue({ announceEvent: publicAnnounce, originStreamId: publicOriginStreamId });
  assert.equal(publicIssue.status, 200);

  const privateStreamId = "allowlisted-routes";
  const privateOriginStreamId = makeOriginStreamId(ownerPubkey, privateStreamId);
  assert.ok(privateOriginStreamId);
  if (!privateOriginStreamId) return;
  const privateAnnounce = signedAnnounce({
    secret: ownerSecret,
    streamId: privateStreamId,
    streamVisibility: "private",
    viewerAllowPubkeys: [viewerPubkey]
  });
  const viewerIssue = await issue({
    announceEvent: privateAnnounce,
    originStreamId: privateOriginStreamId,
    viewerProofEvent: signedViewerProof(viewerSecret, privateOriginStreamId)
  });
  assert.equal(viewerIssue.status, 200);
  const viewerPayload = (await viewerIssue.json()) as { token?: string; reasonCode?: string };
  assert.equal(viewerPayload.reasonCode, "allow_allowlist");
  assert.ok(viewerPayload.token);
});
