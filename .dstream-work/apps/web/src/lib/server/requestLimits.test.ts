import assert from "node:assert/strict";
import { test } from "node:test";
import { allowRateLimitedRequest, readLimitedBody } from "./requestLimits";

test("body limit rejects oversized declared and streamed bodies", async () => {
  await assert.rejects(readLimitedBody(new Request("http://node.test", { method: "POST", headers: { "content-length": "10" }, body: "0123456789" }), 4), /too large/);
  await assert.rejects(readLimitedBody(new Request("http://node.test", { method: "POST", body: "0123456789" }), 4), /too large/);
  assert.equal(new TextDecoder().decode(await readLimitedBody(new Request("http://node.test", { method: "POST", body: "1234" }), 4)), "1234");
});

test("rate limiter permits normal bursts, rejects excess and resets after expiry", () => {
  assert(allowRateLimitedRequest("fixture", 2, 100, 1000));
  assert(allowRateLimitedRequest("fixture", 2, 100, 1001));
  assert(!allowRateLimitedRequest("fixture", 2, 100, 1002));
  assert(allowRateLimitedRequest("fixture", 2, 100, 1101));
});
