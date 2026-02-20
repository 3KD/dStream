# dStream Feature Checklist

> `.agents/CHANGE_CLASSES.md` for classification | `.agents/SELF_ANNEALING.md` for workflow

## Legend
- `[ ]` Not started
- `[x]` Complete
- `[L]` Legacy only

---

## Video - Camera

- [x] Request camera permission
- [x] Release camera on unmount
- [x] Release camera on page unload
- [x] Camera error messages (permission denied, in use, not found)
- [x] Camera loading state
- [ ] Camera device selection dropdown
- [ ] Microphone device selection dropdown
- [ ] Screen share capture
- [ ] Camera + screen picture-in-picture

## Video - Broadcast

- [x] WHIP connection to MediaMTX
- [x] WHIP error handling
- [x] Go Live button
- [x] End Stream button
- [x] Stream key input
- [ ] Stream key auto-generation from pubkey
- [ ] Bitrate selection (low/medium/high)
- [ ] Resolution selection
- [ ] Reconnect on disconnect
- [ ] Caption overlay (speech-to-text)

## Video - Playback

- [x] HLS.js initialization
- [x] Auto-retry when offline
- [x] Loading state
- [x] Error state with retry button
- [ ] Adaptive bitrate switching
- [ ] Low-latency mode toggle
- [ ] Picture-in-picture button
- [ ] Fullscreen button
- [ ] Volume control
- [ ] Playback quality indicator

## Video - P2P

- [L] p2p-media-loader integration
- [L] Tracker configuration
- [L] Peer count display
- [L] Upload speed display
- [L] Download speed display
- [L] Bandwidth saved calculation
- [L] P2P ratio percentage
- [L] Fallback to HTTP on P2P failure

## Video - Integrity

- [L] Manifest signing (broadcaster side)
- [L] Manifest signature verification (viewer side)
- [L] Segment hash verification
- [L] Tamper alert display

---

## Identity - Keys

- [x] Generate local Nostr keypair
- [x] Store keypair in localStorage
- [x] Load keypair on app start
- [x] NIP-07 extension detection
- [x] NIP-07 public key retrieval
- [ ] Export private key
- [ ] Import private key
- [ ] Clear/logout identity
- [ ] Multiple identity support

## Identity - Profile

- [L] Display name editing
- [L] Avatar upload/URL
- [L] Bio/about editing
- [L] Banner image
- [L] Profile save to Nostr (kind:0)
- [L] Profile fetch from Nostr
- [ ] Profile preview

## Identity - NIP-05

- [L] NIP-05 identifier input
- [L] NIP-05 verification check
- [L] NIP-05 badge display
- [L] NIP-05 auto-verify on profile load

## Identity - Keyring (Aliases)

- [L] Set nickname for pubkey
- [L] Get nickname by pubkey
- [L] Persist aliases in localStorage
- [L] `/name @pubkey alias` command

## Identity - Trusted Peers

- [L] Trust a pubkey
- [L] Ban a pubkey
- [L] Unban a pubkey
- [L] Check if pubkey is trusted
- [L] Check if pubkey is banned
- [L] Sync ban list via Nostr (kind:10000)
- [L] Visual indicator for trusted users
- [L] Visual indicator for banned users

## Identity - Badge

- [L] Short pubkey display (first 8 chars)
- [L] Verified badge
- [L] Copy pubkey to clipboard
- [L] Link to profile

---

## Chat - Core

- [x] Subscribe to chat events (kind:1311)
- [x] Dedupe incoming messages
- [x] Sort messages by timestamp
- [x] Limit message history
- [ ] Chat message display
- [ ] Chat timestamp formatting
- [ ] Chat input field
- [ ] Chat send button
- [ ] Send message to Nostr

## Chat - Badges

- [ ] Broadcaster badge
- [ ] Moderator badge
- [ ] Verified badge
- [ ] Subscriber badge

## Chat - Commands

- [L] `/name` - set alias
- [L] `/ban` - ban user
- [L] `/unban` - unban user
- [L] `/mute` - mute user
- [L] `/unmute` - unmute user

## Chat - Whispers

- [L] Encrypt message for recipient
- [L] Encrypt message for multiple recipients
- [L] Decrypt incoming whisper
- [L] Check if user is whisper recipient
- [L] `/wh(user)` single whisper syntax
- [L] `/wh(user1,user2)` multi-whisper syntax
- [L] Whisper visual indicator
- [L] Broadcaster sees all whispers
- [L] Moderator sees all whispers

## Chat - Inbox (DMs)

- [L] Subscribe to DM events (kind:4)
- [L] Decrypt DM content (NIP-04)
- [L] Send encrypted DM
- [L] Conversation thread grouping
- [L] Unread message count
- [L] Mark conversation as read
- [L] Inbox modal UI
- [L] Conversation list
- [L] Message history per conversation

---

## Moderation - Actions

- [L] Ban user button
- [L] Mute user button
- [L] Delete message button
- [L] Unban user button
- [L] Unmute user button

## Moderation - Roles

- [L] Set user as moderator
- [L] Remove moderator role
- [L] Moderator list display

## Moderation - Settings

- [ ] Slow mode toggle
- [ ] Slow mode interval setting
- [ ] Subscriber-only mode toggle
- [ ] Follower-only mode toggle

---

## Guilds - Core

- [L] Create guild
- [L] Guild name
- [L] Guild description
- [L] Guild image/icon
- [L] Publish guild to Nostr

## Guilds - Membership

- [L] Join guild
- [L] Leave guild
- [L] Invite user to guild
- [L] Accept guild invite
- [L] Decline guild invite

## Guilds - Roles

- [L] Guild owner role
- [L] Guild admin role
- [L] Guild member role
- [L] Assign roles

## Guilds - Display

- [L] Guild badge on user
- [L] Guild list sidebar
- [L] Guild members list
- [L] Guild settings panel

---

## Payments - Monero

- [L] XMR address input
- [L] XMR address validation
- [L] Subaddress generation
- [L] Payment amount input
- [L] Payment ID generation
- [L] RPC connection to Monero node
- [L] Check payment received
- [L] Payment confirmation display

## Payments - Escrow

- [L] Escrow amount setting
- [L] Escrow requirement display
- [L] Escrow payment verification
- [L] Escrow release on stream end

## Payments - Tipping UI

- [L] Tip button
- [L] Tip amount presets
- [L] Custom tip amount
- [L] Tip message input
- [L] Tip modal
- [L] Tip confirmation
- [L] Tip alert on stream

## Payments - Other Methods

- [L] Venmo handle input
- [L] CashApp handle input
- [L] PayPal handle input
- [L] Custom payment method input
- [ ] Lightning address input
- [ ] Lightning invoice generation
- [ ] Lightning payment verification

---

## Analytics

- [L] Current viewer count
- [L] Peak viewer count
- [L] Total unique viewers
- [L] Stream duration
- [L] Chat messages count
- [L] Chat messages per minute
- [L] Viewer count chart
- [L] Chat activity chart

## Presence

- [L] Publish presence heartbeat
- [L] Subscribe to presence events
- [L] Calculate active viewers
- [L] Display viewer count

---

## Nostr - Events

- [x] Publish event to relays
- [x] Subscribe to events
- [x] Sign event with local key
- [x] Sign event with NIP-07
- [x] Fetch single event by ID
- [x] Fetch user profile

## Nostr - Stream Announce

- [x] NIP-53 announce function
- [ ] Auto-announce on go live
- [ ] Update announce on metadata change
- [ ] End announce on stream stop

## Nostr - Discovery

- [L] Fetch live streams (kind:30311)
- [L] Filter by status (live/ended)
- [L] Filter by tags
- [L] Search by title
- [L] Search by broadcaster

---

## UI - Pages

- [x] Homepage
- [x] Broadcast page
- [x] Watch page (dynamic route)
- [ ] Browse/discover page
- [ ] Profile page
- [ ] Settings page
- [ ] Dashboard layout

## UI - Components

- [ ] Login modal
- [ ] Profile card
- [ ] Stream card
- [ ] Chat message bubble
- [ ] Chat input
- [ ] Tip button
- [ ] User badge
- [ ] Loading spinner
- [ ] Error display

## UI - Navigation

- [ ] Header/navbar
- [ ] Sidebar
- [ ] Tab navigation
- [ ] Breadcrumbs
- [ ] Back button

---

## Infrastructure

- [x] Next.js 16 setup
- [x] TypeScript config
- [x] Port 4747 (non-standard)
- [x] Context providers
- [ ] Environment variables
- [ ] Docker build
- [ ] Production config
- [ ] CI/CD pipeline

---

*Total: 200+ atomic features*
*Last updated: 2026-01-22*
