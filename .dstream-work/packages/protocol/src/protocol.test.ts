import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildP2PSignalEvent,
  buildGuildEvent,
  buildGuildMembershipEvent,
  buildGuildRoleEvent,
  buildStreamAnnounceEvent,
  buildStreamChatEvent,
  buildStreamManifestRootEvent,
  buildStreamModerationEvent,
  buildStreamModeratorRoleEvent,
  buildStreamPresenceEvent,
  buildXmrTipReceiptEvent,
  buildP2PBytesReceiptEvent,
  decodeP2PSignalPayload,
  deriveSwarmId,
  encodeP2PSignalPayload,
  makeATag,
  parseStreamManifestRootEvent,
  parseP2PSignalEvent,
  parseStreamAnnounceEvent,
  parseStreamChatEvent,
  parseGuildEvent,
  parseGuildMembershipEvent,
  parseGuildRoleEvent,
  parseStreamModerationEvent,
  parseStreamModeratorRoleEvent,
  parseStreamPresenceEvent,
  parseXmrTipReceiptEvent,
  parseP2PBytesReceiptEvent,
  type NostrEvent,
  NOSTR_KINDS
} from "./index";

const STREAM_PUBKEY = "e".repeat(64);
const VIEWER_PUBKEY = "a".repeat(64);
const STREAM_ID = "live-20260205-1510";

test("stream announce: build + parse roundtrip", () => {
  const unsigned = buildStreamAnnounceEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 123,
    streamId: STREAM_ID,
    title: "Hello",
    status: "live",
    summary: "Summary",
    image: "https://example.com/img.png",
    streaming: "https://example.com/index.m3u8",
    xmr: "4".repeat(95),
    hostMode: "p2p_economy",
    rebroadcastThreshold: 6,
    manifestSignerPubkey: "b".repeat(64),
    stakeAmountAtomic: "1000",
    stakeNote: "bond",
    captions: [
      { lang: "en", label: "English", url: "https://example.com/subs-en.vtt", isDefault: true },
      { lang: "es", label: "Español", url: "https://example.com/subs-es.vtt" }
    ],
    renditions: [
      {
        id: "1080p",
        url: "https://example.com/stream/1080.m3u8",
        bandwidth: 6_000_000,
        width: 1920,
        height: 1080,
        codecs: "avc1.640028,mp4a.40.2"
      },
      {
        id: "720p",
        url: "https://example.com/stream/720.m3u8",
        bandwidth: 3_000_000,
        width: 1280,
        height: 720
      }
    ],
    topics: ["zeta", "alpha", "alpha"]
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.STREAM_ANNOUNCE);
  assert.equal(unsigned.pubkey, STREAM_PUBKEY);
  assert.equal(unsigned.created_at, 123);

  const parsed = parseStreamAnnounceEvent(unsigned as NostrEvent);
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.streamId, STREAM_ID);
  assert.equal(parsed.title, "Hello");
  assert.equal(parsed.status, "live");
  assert.equal(parsed.summary, "Summary");
  assert.equal(parsed.image, "https://example.com/img.png");
  assert.equal(parsed.streaming, "https://example.com/index.m3u8");
  assert.equal(parsed.xmr, "4".repeat(95));
  assert.equal(parsed.hostMode, "p2p_economy");
  assert.equal(parsed.rebroadcastThreshold, 6);
  assert.equal(parsed.manifestSignerPubkey, "b".repeat(64));
  assert.equal(parsed.stakeAmountAtomic, "1000");
  assert.equal(parsed.stakeNote, "bond");
  assert.deepEqual(parsed.captions, [
    { lang: "en", label: "English", url: "https://example.com/subs-en.vtt", isDefault: true },
    { lang: "es", label: "Español", url: "https://example.com/subs-es.vtt", isDefault: false }
  ]);
  assert.deepEqual(parsed.renditions, [
    {
      id: "1080p",
      url: "https://example.com/stream/1080.m3u8",
      bandwidth: 6_000_000,
      width: 1920,
      height: 1080,
      codecs: "avc1.640028,mp4a.40.2"
    },
    {
      id: "720p",
      url: "https://example.com/stream/720.m3u8",
      bandwidth: 3_000_000,
      width: 1280,
      height: 720,
      codecs: undefined
    }
  ]);
  assert.deepEqual(parsed.topics, ["alpha", "zeta"]);
});

test("stream announce: rejects wrong kind", () => {
  const parsed = parseStreamAnnounceEvent({
    kind: 1,
    pubkey: STREAM_PUBKEY,
    created_at: 1,
    tags: [["d", STREAM_ID]],
    content: ""
  });
  assert.equal(parsed, null);
});

test("manifest root: build + parse roundtrip", () => {
  const unsigned = buildStreamManifestRootEvent({
    pubkey: "b".repeat(64),
    createdAt: 500,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    renditionId: "video1",
    epochStartMs: 1700000000000,
    epochDurationMs: 12000,
    segments: [{ uri: "seg_001.m4s", sha256: "c".repeat(64), byteLength: 1234 }],
    init: { uri: "init.mp4", sha256: "d".repeat(64), byteLength: 55 }
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.MANIFEST_ROOT);
  const parsed = parseStreamManifestRootEvent(unsigned as NostrEvent);
  assert.ok(parsed);
  assert.equal(parsed.pubkey, "b".repeat(64));
  assert.equal(parsed.streamPubkey, STREAM_PUBKEY);
  assert.equal(parsed.streamId, STREAM_ID);
  assert.equal(parsed.renditionId, "video1");
  assert.equal(parsed.epochStartMs, 1700000000000);
  assert.equal(parsed.epochDurationMs, 12000);
  assert.deepEqual(parsed.segments, [{ uri: "seg_001.m4s", sha256: "c".repeat(64), byteLength: 1234 }]);
  assert.deepEqual(parsed.init, { uri: "init.mp4", sha256: "d".repeat(64), byteLength: 55 });
});

test("xmr receipt: build + parse roundtrip", () => {
  const unsigned = buildXmrTipReceiptEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 900,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    amountAtomic: "1000",
    confirmed: false,
    observedAtMs: 1700000050000
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.XMR_RECEIPT);
  const parsed = parseXmrTipReceiptEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.amountAtomic, "1000");
  assert.equal(parsed.confirmed, false);
});

test("p2p bytes receipt: build + parse roundtrip", () => {
  const unsigned = buildP2PBytesReceiptEvent({
    pubkey: VIEWER_PUBKEY,
    createdAt: 950,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    fromPubkey: STREAM_PUBKEY,
    servedBytes: 262144,
    observedAtMs: 1700000060000,
    sessionId: "sess-a"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.P2P_BYTES_RECEIPT);
  const parsed = parseP2PBytesReceiptEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.ok(parsed);
  assert.equal(parsed.pubkey, VIEWER_PUBKEY);
  assert.equal(parsed.fromPubkey, STREAM_PUBKEY);
  assert.equal(parsed.servedBytes, 262144);
  assert.equal(parsed.sessionId, "sess-a");
});

test("guild: build + parse roundtrip", () => {
  const guildId = "builders";
  const unsigned = buildGuildEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 777,
    guildId,
    name: "Builders Guild",
    about: "curated streams",
    image: "https://example.com/guild.png",
    topics: ["alpha", "alpha", "zeta"],
    featuredStreams: [
      { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID },
      { streamPubkey: "b".repeat(64), streamId: "demo:stream" }
    ]
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.GUILD);
  const parsed = parseGuildEvent(unsigned as NostrEvent);
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.guildId, guildId);
  assert.equal(parsed.name, "Builders Guild");
  assert.equal(parsed.about, "curated streams");
  assert.equal(parsed.image, "https://example.com/guild.png");
  assert.deepEqual(parsed.topics, ["alpha", "zeta"]);
  assert.deepEqual(parsed.featuredStreams, [
    { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID },
    { streamPubkey: "b".repeat(64), streamId: "demo:stream" }
  ]);
});

test("guild membership: build + parse roundtrip", () => {
  const unsigned = buildGuildMembershipEvent({
    pubkey: VIEWER_PUBKEY,
    createdAt: 778,
    guildPubkey: STREAM_PUBKEY,
    guildId: "builders",
    status: "joined"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.GUILD_MEMBERSHIP);
  const parsed = parseGuildMembershipEvent(unsigned as NostrEvent);
  assert.ok(parsed);
  assert.equal(parsed.pubkey, VIEWER_PUBKEY);
  assert.equal(parsed.guildPubkey, STREAM_PUBKEY);
  assert.equal(parsed.guildId, "builders");
  assert.equal(parsed.status, "joined");
});

test("guild role: build + parse roundtrip", () => {
  const unsigned = buildGuildRoleEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 779,
    guildPubkey: STREAM_PUBKEY,
    guildId: "builders",
    targetPubkey: VIEWER_PUBKEY,
    role: "moderator"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.GUILD_ROLE);
  const parsed = parseGuildRoleEvent(unsigned as NostrEvent);
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.guildPubkey, STREAM_PUBKEY);
  assert.equal(parsed.guildId, "builders");
  assert.equal(parsed.targetPubkey, VIEWER_PUBKEY);
  assert.equal(parsed.role, "moderator");
});

test("stream moderation: build + parse scoped to stream", () => {
  const unsigned = buildStreamModerationEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 780,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    targetPubkey: VIEWER_PUBKEY,
    action: "block",
    reason: "spam"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.STREAM_MOD_ACTION);
  const parsed = parseStreamModerationEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.ok(parsed);
  assert.equal(parsed.targetPubkey, VIEWER_PUBKEY);
  assert.equal(parsed.action, "block");
  assert.equal(parsed.reason, "spam");
});

test("stream moderator role: build + parse scoped to stream", () => {
  const unsigned = buildStreamModeratorRoleEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 781,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    targetPubkey: VIEWER_PUBKEY,
    role: "moderator"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.STREAM_MOD_ROLE);
  const parsed = parseStreamModeratorRoleEvent(unsigned as NostrEvent, {
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID
  });
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.targetPubkey, VIEWER_PUBKEY);
  assert.equal(parsed.role, "moderator");
});

test("stream subscriber role: build + parse scoped to stream", () => {
  const unsigned = buildStreamModeratorRoleEvent({
    pubkey: STREAM_PUBKEY,
    createdAt: 782,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    targetPubkey: VIEWER_PUBKEY,
    role: "subscriber"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.STREAM_MOD_ROLE);
  const parsed = parseStreamModeratorRoleEvent(unsigned as NostrEvent, {
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID
  });
  assert.ok(parsed);
  assert.equal(parsed.pubkey, STREAM_PUBKEY);
  assert.equal(parsed.targetPubkey, VIEWER_PUBKEY);
  assert.equal(parsed.role, "subscriber");
});

test("chat: scoped by a-tag", () => {
  const unsigned = buildStreamChatEvent({
    pubkey: VIEWER_PUBKEY,
    createdAt: 555,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    content: "hello"
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.STREAM_CHAT);
  const ok = parseStreamChatEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.ok(ok);
  assert.equal(ok.content, "hello");

  const wrong = parseStreamChatEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: "other" });
  assert.equal(wrong, null);
});

test("presence: scoped by a-tag", () => {
  const unsigned = buildStreamPresenceEvent({
    pubkey: VIEWER_PUBKEY,
    createdAt: 777,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.PRESENCE);
  const ok = parseStreamPresenceEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.ok(ok);

  const wrong = parseStreamPresenceEvent(unsigned as NostrEvent, { streamPubkey: STREAM_PUBKEY, streamId: "other" });
  assert.equal(wrong, null);
});

test("p2p signaling: build + parse", () => {
  const unsigned = buildP2PSignalEvent({
    pubkey: VIEWER_PUBKEY,
    createdAt: 1000,
    recipientPubkey: STREAM_PUBKEY,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    content: "ciphertext",
    expiresAt: 2000
  });

  assert.equal(unsigned.kind, NOSTR_KINDS.P2P_SIGNAL);
  assert.ok(unsigned.tags.some((t) => t[0] === "p" && t[1] === STREAM_PUBKEY));
  assert.ok(unsigned.tags.some((t) => t[0] === "a" && t[1] === makeATag(STREAM_PUBKEY, STREAM_ID)));
  assert.ok(unsigned.tags.some((t) => t[0] === "expiration" && t[1] === "2000"));

  const parsed = parseP2PSignalEvent(unsigned as NostrEvent, {
    recipientPubkey: STREAM_PUBKEY,
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID
  });
  assert.ok(parsed);
  assert.equal(parsed.pubkey, VIEWER_PUBKEY);
  assert.equal(parsed.recipientPubkey, STREAM_PUBKEY);
  assert.equal(parsed.content, "ciphertext");
});

test("p2p payload: encode + decode", () => {
  const payload = {
    v: 1,
    type: "offer",
    sessionId: "s1",
    streamPubkey: STREAM_PUBKEY,
    streamId: STREAM_ID,
    swarmId: "swarm",
    sdp: "v=0"
  } as const;

  const encoded = encodeP2PSignalPayload(payload);
  const decoded = decodeP2PSignalPayload(encoded);
  assert.deepEqual(decoded, payload);

  assert.equal(decodeP2PSignalPayload(""), null);
  assert.equal(decodeP2PSignalPayload("{not json"), null);
  assert.equal(
    decodeP2PSignalPayload(
      JSON.stringify({ v: 1, type: "offer", sessionId: "x", streamPubkey: "nope", streamId: "x", sdp: "v=0" })
    ),
    null
  );
});

test("deriveSwarmId: deterministic (when WebCrypto is available)", async (t) => {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle?.digest) {
    t.skip("WebCrypto subtle.digest unavailable");
    return;
  }
  const a = await deriveSwarmId({ streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  const b = await deriveSwarmId({ streamPubkey: STREAM_PUBKEY, streamId: STREAM_ID });
  assert.equal(a, b);
  assert.ok(a.length > 10);
});
