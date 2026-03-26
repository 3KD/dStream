# dStream — Next: Open Recommendation Algorithm

Status: Design phase. Not attached to the app yet.

## Concept

A client-side open-source recommendation algorithm where your watch history never leaves your device. Uses public Nostr signals for social/content data, private on-device signals for personalization. No central server sees what you watch.

Nothing like this exists on any decentralized platform today.

## Available signals

### Public (fetched from Nostr relays)
- Social graph / follows (kind 3)
- Stream announce metadata — tags, topics, titles (kind 30311)
- Presence events — who's watching what (kind 30312)
- Guild memberships (kind 30319)
- Favorites (could be published)
- Tip/stake history — public receipts (kind 30314)
- Chat activity patterns (kind 1311)
- Moderation trust lists (trusted/muted/blocked)

### Private (on-device only, never transmitted)
- Watch history (IndexedDB / localStorage)
- Watch duration per stream
- Vectorized content preferences (embeddings from titles/topics)
- Click-through patterns
- Time-of-day preferences

## Key design constraint

Private signals stay on-device. Public signals are fetched from relays. The algorithm merges both locally. Nobody else can see your recommendations or infer your viewing habits.

## Open questions

- Scoring model: collaborative filtering from social graph? Content-based from tags/topics? Hybrid?
- Cold start: what do you show a brand new user with no history?
- Embeddings: run a small model on-device for title/topic vectorization? Or precompute?
- How to make it work without a training dataset (no central server collecting interactions)
- Should the algorithm itself be swappable (like Bluesky's feed generators)?
- Performance: can this run client-side on a phone without killing battery?

## Integration point

Plugs into dStream's browse/home page as an alternative to chronological stream listing. User chooses: chronological, trending (by presence count), or recommended (personal algorithm).
