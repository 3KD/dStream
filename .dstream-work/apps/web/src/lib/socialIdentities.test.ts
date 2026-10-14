import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyNip39Draft,
  mergeNip39Tags,
  normalizeNip39Identity,
  normalizeNip39Proof,
  parseNip39Event,
  socialIdentityProfileUrl,
  socialIdentityProofUrl
} from "./socialIdentities";

const PUBKEY = "a".repeat(64);

test("parseNip39Event: reads valid identity claims and ignores malformed tags", () => {
  const parsed = parseNip39Event({
    id: "b".repeat(64),
    sig: "c".repeat(128),
    pubkey: PUBKEY,
    kind: 10011,
    created_at: 100,
    content: "",
    tags: [
      ["i", "github:alice", "abc123"],
      ["i", "missing-proof"],
      ["client", "dstream"]
    ]
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.claims, [{ platform: "github", identity: "alice", proof: "abc123" }]);
  assert.equal(parsed.tags.length, 3);
});

test("NIP-39 normalizers accept account and proof URLs", () => {
  assert.equal(normalizeNip39Identity("github", "https://github.com/Alice"), "alice");
  assert.equal(normalizeNip39Identity("twitter", "@Alice_123"), "alice_123");
  assert.equal(normalizeNip39Identity("mastodon", "https://mastodon.social/@Alice"), "mastodon.social/@alice");
  assert.equal(normalizeNip39Proof("twitter", "https://x.com/alice/status/123456"), "123456");
  assert.equal(normalizeNip39Proof("discord", "https://discord.com/channels/1/2/3"), "1/2/3");
});

test("mergeNip39Tags replaces managed claims without deleting unknown extensions", () => {
  const draft = emptyNip39Draft();
  draft.github = { identity: "new-user", proof: "new-proof" };
  const tags = mergeNip39Tags(
    [
      ["i", "github:old-user", "old-proof"],
      ["i", "youtube:@channel", "channel-about"],
      ["client", "another-client"]
    ],
    draft
  );

  assert.deepEqual(tags, [
    ["i", "youtube:@channel", "channel-about"],
    ["client", "another-client"],
    ["i", "github:new-user", "new-proof"]
  ]);
});

test("social identity URLs point to the account and its proof", () => {
  const claim = { platform: "bluesky", identity: "alice.bsky.social", proof: "3abc" };
  assert.equal(socialIdentityProfileUrl(claim), "https://bsky.app/profile/alice.bsky.social");
  assert.equal(socialIdentityProofUrl(claim), "https://bsky.app/profile/alice.bsky.social/post/3abc");
});
