import { Relay } from "nostr-tools";

const CURRENT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.mom",
  "wss://offchain.pub",
  "wss://purplepag.es",
  "wss://relay.nostr.wirednet.jp"
];

const NEW_RELAYS = [
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://eden.nostr.land",
  "wss://relay.nostr.bg",
  "wss://nostr-pub.wellorder.net"
];

const KINDS = [30311];
const LOOKBACK_SECS = 45 * 24 * 60 * 60; // 45 days
const SINCE = Math.floor(Date.now() / 1000) - LOOKBACK_SECS;

async function queryRelay(url: string, since: number): Promise<any[]> {
  try {
    const relay = await Relay.connect(url);
    const events: any[] = [];
    
    return new Promise((resolve) => {
      let resolved = false;
      
      const sub = relay.subscribe([{ kinds: KINDS, since }], {
        onevent(event) {
          events.push(event);
        },
        oneose() {
          if (!resolved) {
            resolved = true;
            relay.close();
            resolve(events);
          }
        }
      });
      
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          sub.close();
          relay.close();
          resolve(events);
        }
      }, 6000);
    });
  } catch (err: any) {
    console.log(`Failed to connect to ${url}: ${err.message}`);
    return [];
  }
}

function dedupeStreams(events: any[]) {
  // Deduplicate by Canonical Stream Key Logic from DStream
  const streamsByKey = new Map();
  for (const ev of events) {
    let dTag = "";
    for (const t of ev.tags) if (t[0] === "d" && t[1]) dTag = t[1];
    
    if (dTag) {
      const key = `${ev.pubkey}::${dTag}`;
      const existing = streamsByKey.get(key);
      if (!existing || ev.created_at > existing.created_at) {
        streamsByKey.set(key, ev);
      }
    }
  }
  return streamsByKey;
}

async function run() {
  console.log("Analyzing stream distributions...\n");
  
  const currentEvents = new Map<string, any>();
  const currentRelayCounts = new Map<string, number>();
  
  console.log("=== Fetching from CURRENT relays ===");
  for (const url of CURRENT_RELAYS) {
    process.stdout.write(`Fetching from ${url}... `);
    const events = await queryRelay(url, SINCE);
    const dedupedRaw = dedupeStreams(events);
    currentRelayCounts.set(url, dedupedRaw.size);
    for (const [key, ev] of dedupedRaw) {
      const existing = currentEvents.get(key);
      if (!existing || ev.created_at > existing.created_at) {
        currentEvents.set(key, ev);
      }
    }
    console.log(`found ${dedupedRaw.size} unique streams.`);
  }
  console.log(`\nTOTAL UNIQUE IN CURRENT RELAYS: ${currentEvents.size}\n`);

  const newEvents = new Map<string, any>();
  const newRelayCounts = new Map<string, number>();

  console.log("=== Fetching from POTENTIAL NEW relays ===");
  for (const url of NEW_RELAYS) {
    process.stdout.write(`Fetching from ${url}... `);
    const events = await queryRelay(url, SINCE);
    const dedupedRaw = dedupeStreams(events);
    newRelayCounts.set(url, dedupedRaw.size);
    for (const [key, ev] of dedupedRaw) {
      const existing = newEvents.get(key);
      if (!existing || ev.created_at > existing.created_at) {
        newEvents.set(key, ev);
      }
    }
    console.log(`found ${dedupedRaw.size} unique streams.`);
  }
  console.log(`\nTOTAL UNIQUE IN POTENTIAL NEW RELAYS: ${newEvents.size}\n`);

  // Compute how many streams from the new relays are strictly EXCLUSIVE to them
  let pureExclusiveCount = 0;
  for (const key of newEvents.keys()) {
    if (!currentEvents.has(key)) {
      pureExclusiveCount++;
    }
  }

  console.log("=== SUMMARY ===");
  console.log(`Current Relays Total Base Coverage: ${currentEvents.size} streams`);
  console.log(`Potential New Relays Total Coverage: ${newEvents.size} streams`);
  console.log(`EXCLUSIVE Additional Streams If Added: +${pureExclusiveCount} streams`);
  
  const percentageIncreaes = ((pureExclusiveCount / (currentEvents.size || 1)) * 100).toFixed(1);
  console.log(`Overall Base Increase: +${percentageIncreaes}%`);
}

run().catch(console.error);
