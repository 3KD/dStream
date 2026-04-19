const { parseStreamAnnounceEvent } = require("./packages/protocol/dist/index.js");

const event = {
  kind: 30311,
  created_at: 123456,
  pubkey: "abc",
  tags: [
    ["d", "stream-id"],
    ["status", "live"],
    ["current_participants", "6"]
  ]
};

console.log(parseStreamAnnounceEvent(event));
