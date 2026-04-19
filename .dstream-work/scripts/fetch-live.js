const { Relay } = require('nostr-tools');

async function go() {
  console.log("Connecting to damus...");
  const relay = await Relay.connect('wss://relay.damus.io');
  let found = 0;
  relay.subscribe([{ kinds: [30311], limit: 20 }], {
    onevent(e) {
      if (e.tags.some(t => t[0] === "current_participants" || t[0] === "viewers" || t.includes("6"))) {
        console.log("MATCH:", JSON.stringify(e));
        found++;
      } else {
        console.log("EVENT tags:", e.tags);
      }
    }
  });
  
  setTimeout(() => {
    console.log("Found:", found);
    process.exit(0);
  }, 4000);
}
go();
