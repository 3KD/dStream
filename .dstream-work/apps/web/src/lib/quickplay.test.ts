import assert from "node:assert/strict";
import test from "node:test";
import { deriveQuickPlayWhepUrl } from "./quickplay";

const pubkey = "05e60159f1e0a6cb64fa573fc1ebe35f985a975defe7d75603fdb9e8cfd38334";

test("external HLS streams do not receive a fabricated local WHEP endpoint", () => {
  const result = deriveQuickPlayWhepUrl(
    { pubkey, streamId: "synthdragon-chill" },
    "https://synthdragon-hls-lite.fly.dev/hls/chill/index.m3u8"
  );
  assert.equal(result, undefined);
});

test("local HLS streams receive the matching local WHEP endpoint", () => {
  const result = deriveQuickPlayWhepUrl(
    { pubkey, streamId: "local-stream" },
    `/api/hls/${pubkey}--local-stream/index.m3u8`
  );
  assert.equal(result, `/api/whep/${pubkey}--local-stream/whep`);
});
