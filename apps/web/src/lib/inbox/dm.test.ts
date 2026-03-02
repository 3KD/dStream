import test from "node:test";
import assert from "node:assert/strict";

import { getPublicKey, nip04 } from "nostr-tools";
import { buildDmThreadSummaries, getDmDirection, getDmPeerPubkey, getDmRecipientPubkey, type DmMessage } from "./dm";

test("DM parsing: peer + direction", () => {
  const alice = "a".repeat(64);
  const bob = "b".repeat(64);
  const carol = "c".repeat(64);

  const inbound = { pubkey: alice, tags: [["p", bob]] };
  assert.equal(getDmRecipientPubkey(inbound), bob);
  assert.equal(getDmPeerPubkey(inbound, bob), alice);
  assert.equal(getDmDirection(inbound, bob), "in");

  const outbound = { pubkey: bob, tags: [["p", alice]] };
  assert.equal(getDmRecipientPubkey(outbound), alice);
  assert.equal(getDmPeerPubkey(outbound, bob), alice);
  assert.equal(getDmDirection(outbound, bob), "out");

  const unrelated = { pubkey: alice, tags: [["p", carol]] };
  assert.equal(getDmPeerPubkey(unrelated, bob), null);
  assert.equal(getDmDirection(unrelated, bob), null);
});

test("DM decrypt: NIP-04 roundtrip", async () => {
  const aliceSk = Buffer.from("1".repeat(64), "hex");
  const bobSk = Buffer.from("2".repeat(64), "hex");
  const alicePk = getPublicKey(aliceSk);
  const bobPk = getPublicKey(bobSk);

  const plaintext = "hello dm";
  const ciphertext = nip04.encrypt(aliceSk, bobPk, plaintext);
  const event = { kind: 4, pubkey: alicePk, tags: [["p", bobPk]], content: ciphertext };

  const peer = getDmPeerPubkey(event, bobPk);
  assert.equal(peer, alicePk);
  assert.equal(getDmDirection(event, bobPk), "in");
  assert.equal(getDmRecipientPubkey(event), bobPk);

  const decrypted = nip04.decrypt(bobSk, peer!, ciphertext);
  assert.equal(decrypted, plaintext);

  const threads = buildDmThreadSummaries(
    [
      {
        id: "e1",
        peerPubkey: peer!,
        senderPubkey: alicePk,
        recipientPubkey: bobPk,
        createdAt: 123,
        direction: "in",
        content: decrypted
      }
    ],
    {}
  );
  assert.equal(threads[0]?.peerPubkey, alicePk);
  assert.equal(threads[0]?.unreadCount, 1);
});

test("DM threads: grouping + unread counts", () => {
  const alice = "a".repeat(64);
  const bob = "b".repeat(64);
  const dave = "d".repeat(64);

  const msgs: DmMessage[] = [
    { id: "1", peerPubkey: alice, senderPubkey: alice, recipientPubkey: bob, createdAt: 10, direction: "in", content: "hi" },
    { id: "2", peerPubkey: alice, senderPubkey: bob, recipientPubkey: alice, createdAt: 20, direction: "out", content: "yo" },
    { id: "3", peerPubkey: dave, senderPubkey: dave, recipientPubkey: bob, createdAt: 15, direction: "in", content: "ping" }
  ];

  const threadsUnread = buildDmThreadSummaries(msgs, { [alice]: 0 });
  assert.equal(threadsUnread[0]?.peerPubkey, alice);
  assert.equal(threadsUnread[0]?.unreadCount, 1);

  const threadsRead = buildDmThreadSummaries(msgs, { [alice]: 10, [dave]: 999 });
  const aliceThread = threadsRead.find((t) => t.peerPubkey === alice);
  assert.equal(aliceThread?.unreadCount, 0);
  const daveThread = threadsRead.find((t) => t.peerPubkey === dave);
  assert.equal(daveThread?.unreadCount, 0);
});
