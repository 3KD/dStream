import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfileContent, serializeProfileContent, normalizeNip05 } from "./profile";

test("normalizeNip05: accepts valid identifier", () => {
  assert.equal(normalizeNip05("Alice@Example.com"), "alice@example.com");
});

test("normalizeNip05: rejects invalid identifier", () => {
  assert.equal(normalizeNip05("no-at-symbol"), undefined);
  assert.equal(normalizeNip05("bad@domain"), undefined);
});

test("parseProfileContent: parses and normalizes fields", () => {
  const parsed = parseProfileContent(
    JSON.stringify({
      name: " alice ",
      display_name: "Alice Example",
      about: "  hello world  ",
      picture: "https://example.com/a.png",
      banner: "https://example.com/b.png",
      website: "https://example.com",
      youtube: "https://youtube.com/@alice",
      github: "https://github.com/alice",
      nip05: "Alice@example.com"
    })
  );
  assert.equal(parsed.name, "alice");
  assert.equal(parsed.displayName, "Alice Example");
  assert.equal(parsed.about, "hello world");
  assert.equal(parsed.picture, "https://example.com/a.png");
  assert.equal(parsed.youtube, "https://youtube.com/@alice");
  assert.equal(parsed.github, "https://github.com/alice");
  assert.equal(parsed.nip05, "alice@example.com");
});

test("serializeProfileContent: writes normalized JSON", () => {
  const json = serializeProfileContent({
    name: "Alice",
    displayName: "Alice Display",
    about: "bio",
    picture: "https://example.com/p.png",
    banner: "https://example.com/b.png",
    website: "https://example.com",
    youtube: "https://youtube.com/@alice",
    twitter: "https://x.com/alice",
    nip05: "alice@example.com"
  });
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, "Alice");
  assert.equal(parsed.display_name, "Alice Display");
  assert.equal(parsed.youtube, "https://youtube.com/@alice");
  assert.equal(parsed.twitter, "https://x.com/alice");
  assert.equal(parsed.nip05, "alice@example.com");
});

test("parseProfileContent: rejects unsafe or mislabeled social links", () => {
  const parsed = parseProfileContent(JSON.stringify({ youtube: "https://example.com/not-youtube", github: "github.com/alice" }));
  assert.equal(parsed.youtube, undefined);
  assert.equal(parsed.github, undefined);
});
