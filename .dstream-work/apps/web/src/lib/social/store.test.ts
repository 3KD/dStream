import assert from "node:assert/strict";
import { test } from "node:test";
import { nip19 } from "nostr-tools";
import {
  createDefaultSocialState,
  makeStreamFavoriteKey,
  normalizePubkey,
  normalizeSocialState,
  parseSocialState,
  parseStreamFavoriteKey
} from "./store";

test("normalizePubkey accepts hex and npub", () => {
  const pk = "a".repeat(64);
  const npub = nip19.npubEncode(pk);

  assert.equal(normalizePubkey(pk.toUpperCase()), pk);
  assert.equal(normalizePubkey(npub), pk);
  assert.equal(normalizePubkey(""), null);
  assert.equal(normalizePubkey("not a key"), null);
});

test("stream favorite key round-trips", () => {
  const pk = "b".repeat(64);
  const streamId = "live-20260207-1200";
  const key = makeStreamFavoriteKey(pk, streamId);
  assert.ok(key);
  assert.deepEqual(parseStreamFavoriteKey(key), { streamPubkeyHex: pk, streamId });
});

test("normalizeSocialState coerces lists and settings", () => {
  const pkA = "a".repeat(64);
  const pkB = "b".repeat(64);
  const pkC = "c".repeat(64);

  const npubB = nip19.npubEncode(pkB);

  const key1 = makeStreamFavoriteKey(pkA, "s1")!;
  const key2 = makeStreamFavoriteKey(pkB, "s2")!;

  const input: any = {
    version: 1,
    aliases: {
      [pkA.toUpperCase()]: "  Alice  ",
      [npubB]: "Bob"
    },
    trustedPubkeys: [npubB, pkA.toUpperCase(), pkA],
    mutedPubkeys: [pkC],
    blockedPubkeys: [pkC.toUpperCase(), "bad"],
    favorites: {
      creators: [npubB, pkA, pkA],
      streams: [key2, "bad", key1]
    },
    settings: {
      presenceEnabled: false,
      p2pAssistEnabled: true,
      p2pPeerMode: "trusted_only",
      playbackAutoplayMuted: false,
      showMatureContent: true,
      broadcastHostMode: "host_only",
      broadcastRebroadcastThreshold: 9,
      paymentDefaults: {
        xmrTipAddress: ` ${"4".repeat(95)} `,
        stakeXmr: "0.05 ",
        stakeNote: "  note  ",
        paymentMethods: [
          { asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum", label: "EVM" },
          { asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" }
        ],
        preferredWalletByAsset: {
          xmr: "cake",
          eth: "metamask",
          bad: "unknown"
        }
      }
    }
  };

  const normalized = normalizeSocialState(input);
  assert.ok(normalized);

  assert.equal(normalized.version, 1);
  assert.deepEqual(normalized.aliases, { [pkA]: "Alice", [pkB]: "Bob" });

  assert.deepEqual(normalized.trustedPubkeys, [pkA, pkB]);
  assert.deepEqual(normalized.mutedPubkeys, [pkC]);
  assert.deepEqual(normalized.blockedPubkeys, [pkC]);

  assert.deepEqual(normalized.favorites.creators, [pkA, pkB]);
  assert.deepEqual(normalized.favorites.streams, [key1, key2]);

  assert.equal(normalized.settings.presenceEnabled, false);
  assert.equal(normalized.settings.p2pAssistEnabled, true);
  assert.equal(normalized.settings.p2pPeerMode, "trusted_only");
  assert.equal(normalized.settings.playbackAutoplayMuted, false);
  assert.equal(normalized.settings.showMatureContent, true);
  assert.equal(normalized.settings.broadcastHostMode, "host_only");
  assert.equal(normalized.settings.broadcastRebroadcastThreshold, 9);
  assert.deepEqual(normalized.settings.paymentDefaults, {
    xmrTipAddress: "4".repeat(95),
    stakeXmr: "0.05",
    stakeNote: "note",
    paymentMethods: [
      { asset: "eth", address: "0x1111111111111111111111111111111111111111", network: "ethereum", label: "EVM" },
      { asset: "btc", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", network: undefined, label: undefined }
    ],
    preferredWalletByAsset: {
      xmr: "cake",
      eth: "metamask"
    }
  });
});

test("normalizeSocialState drops invalid xmr defaults", () => {
  const input: any = {
    version: 1,
    aliases: {},
    trustedPubkeys: [],
    mutedPubkeys: [],
    blockedPubkeys: [],
    favorites: { creators: [], streams: [] },
    settings: {
      paymentDefaults: {
        xmrTipAddress: "48ab...def"
      }
    }
  };

  const normalized = normalizeSocialState(input);
  assert.ok(normalized);
  assert.equal(normalized.settings.paymentDefaults.xmrTipAddress, "");
});

test("parseSocialState returns null for wrong version", () => {
  const raw = JSON.stringify({ version: 999 });
  assert.equal(parseSocialState(raw), null);
});

test("createDefaultSocialState creates versioned state", () => {
  const state = createDefaultSocialState();
  assert.equal(state.version, 1);
  assert.ok(state.settings);
  assert.equal(state.settings.showMatureContent, false);
});
