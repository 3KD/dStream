# dStream Build Path

> **Downstream ordering**: Each item depends ONLY on items above it.
> Build top-to-bottom. No skipping.

---

## Tier 0: Foundation (No Dependencies)

```
001. Next.js app initialized
002. TypeScript configured
003. Port 4747 configured
004. Core types defined (src/lib/types.ts)
005. App config defined (src/lib/config.ts)
```

## Tier 1: Pure Libraries (Depend only on Tier 0)

```
006. Hex to bytes utility
007. Bytes to hex utility
008. Short pubkey formatter (8 chars)
009. Timestamp formatter
010. Local storage get helper
011. Local storage set helper
012. Local storage delete helper
```

## Tier 2: Crypto & Keys (Depend on Tier 1)

```
013. Generate Nostr keypair
014. Get public key from private key
015. Sign message with private key
016. Verify signature
017. NIP-04 encrypt
018. NIP-04 decrypt
019. Whisper encrypt (multi-recipient)
020. Whisper decrypt
```

## Tier 3: Nostr Core (Depend on Tier 2)

```
021. Create SimplePool instance
022. Publish event to relays
023. Subscribe to events
024. Unsubscribe from events
025. Fetch single event by ID
026. Create unsigned event
027. Finalize event (sign)
028. NIP-07 detect extension
029. NIP-07 get public key
030. NIP-07 sign event
```

## Tier 4: Identity State (Depend on Tier 3)

```
031. IdentityContext create
032. Store identity in localStorage
033. Load identity from localStorage
034. Generate new identity
035. Connect via NIP-07
036. Logout (clear identity)
037. useIdentity hook
```

## Tier 5: Media Capture (Depend on Tier 1)

```
038. Request camera permission
039. Request microphone permission
040. Get media stream
041. Stop media stream
042. Handle permission denied error
043. Handle device not found error
044. Handle device in use error
045. Release on unmount
046. Release on page unload
047. useCamera hook
```

## Tier 6: WebRTC/WHIP (Depend on Tier 5)

```
048. Create RTCPeerConnection
049. Add tracks to connection
050. Create SDP offer
051. Wait for ICE gathering
052. POST offer to WHIP endpoint
053. Set remote SDP answer
054. Close connection
055. WhipClient class
```

## Tier 7: HLS Playback (Depend on Tier 1)

```
056. Initialize HLS.js
057. Load HLS source
058. Attach to video element
059. Handle manifest parsed
060. Handle fatal error
061. Destroy HLS instance
062. Safari native HLS fallback
```

## Tier 8: Broadcast State (Depend on Tier 6, 4)

```
063. BroadcastContext create
064. Store broadcast session
065. Start broadcast (connect WHIP)
066. Stop broadcast (disconnect)
067. Update stream metadata
068. useBroadcast hook
```

## Tier 9: Profile (Depend on Tier 4, 3)

```
069. Fetch profile from Nostr (kind:0)
070. Parse profile JSON
071. Publish profile to Nostr
072. Cache profile locally
073. Profile display component
```

## Tier 10: Stream Announce (Depend on Tier 8, 3)

```
074. Create NIP-53 announce event
075. Publish stream announce
076. Update stream status (live/ended)
077. Update stream metadata
078. Auto-announce on go live
079. Auto-end on stream stop
```

## Tier 11: Identity UI (Depend on Tier 4, 9)

```
080. Login modal component
081. Generate identity button
082. Connect extension button
083. Display current identity
084. Logout button
085. Profile editor form
086. Save profile button
```

## Tier 12: Chat Core (Depend on Tier 4, 3)

```
087. Subscribe to chat events (kind:1311)
088. Create chat message event
089. Publish chat message
090. Dedupe received messages
091. Sort messages by timestamp
092. Limit message history
093. useChat hook
```

## Tier 13: Chat UI (Depend on Tier 12, 11)

```
094. Chat container component
095. Chat message component
096. Chat input component
097. Send message handler
098. Message timestamp display
099. Sender name display
100. Broadcaster badge
```

## Tier 14: Keyring (Depend on Tier 4)

```
101. Store alias in localStorage
102. Get alias by pubkey
103. Delete alias
104. KeyringContext
105. useKeyring hook
106. /name command parser
```

## Tier 15: Trusted Peers (Depend on Tier 4, 3)

```
107. Store banned pubkeys
108. Store trusted pubkeys
109. Check if banned
110. Check if trusted
111. Ban pubkey
112. Unban pubkey
113. Trust pubkey
114. Untrust pubkey
115. Sync ban list via Nostr
116. TrustedPeersContext
```

## Tier 16: Chat Enhanced (Depend on Tier 13, 14, 15)

```
117. Display alias instead of pubkey
118. Hide banned user messages
119. Trusted user indicator
120. Banned user indicator
121. /ban command
122. /unban command
123. /mute command
```

## Tier 17: Whispers (Depend on Tier 12, 2)

```
124. Create whisper event (kind:20004)
125. Encrypt for single recipient
126. Encrypt for multiple recipients
127. Decrypt received whisper
128. Check if recipient
129. /wh(user) command parser
130. /wh(user1,user2) command parser
131. Whisper indicator in chat
132. Broadcaster sees all whispers
```

## Tier 18: Inbox/DMs (Depend on Tier 4, 3, 2)

```
133. Subscribe to DM events (kind:4)
134. Decrypt DM content
135. Create DM event
136. Encrypt DM content
137. Group by conversation
138. Track unread count
139. Mark as read
140. InboxContext
141. useInbox hook
142. Inbox modal component
143. Conversation list
144. Message thread display
```

## Tier 19: Moderation (Depend on Tier 15, 12)

```
145. Delete message (local hide)
146. Ban user from chat
147. Unban user
148. Set moderator role
149. Remove moderator role
150. Moderator badge
151. Moderation panel component
```

## Tier 20: Presence (Depend on Tier 4, 3)

```
152. Create presence event (kind:30312)
153. Publish presence heartbeat
154. Subscribe to presence events
155. Calculate viewer count
156. usePresence hook
157. Viewer count display
```

## Tier 21: Discovery (Depend on Tier 3, 7)

```
158. Subscribe to stream announces
159. Filter by status (live)
160. Filter by recent (24h)
161. Parse stream metadata
162. useNostrStreams hook
163. Stream card component
164. Browse page
165. Search by title
166. Filter by tags
```

## Tier 22: Guilds (Depend on Tier 4, 3)

```
167. Create guild event
168. Guild name/description
169. Publish guild
170. Join guild
171. Leave guild
172. Guild member list
173. Guild owner role
174. Guild admin role
175. Invite to guild
176. Accept invite
177. Guild badge component
178. Guild list sidebar
179. GuildManagement component
180. useNostrGuilds hook
```

## Tier 23: Payments - Monero (Depend on Tier 4)

```
181. XMR address input
182. Validate XMR address
183. Generate subaddress
184. Generate payment ID
185. MoneroRPC client
186. Check payment received
187. Payment confirmation display
```

## Tier 24: Payments - Tipping (Depend on Tier 23, 11)

```
188. Tip amount presets
189. Custom tip amount input
190. Tip message input
191. TipContext
192. Tip button component
193. Tip modal
194. Send tip (trigger payment)
195. Tip alert on stream
```

## Tier 25: Payments - Escrow (Depend on Tier 23)

```
196. Escrow amount setting
197. Escrow requirement check
198. Escrow payment verification
199. EscrowContext
200. Escrow display on watch page
```

## Tier 26: Analytics (Depend on Tier 20, 12)

```
201. Track current viewers
202. Track peak viewers
203. Track total unique viewers
204. Track stream duration
205. Track chat message count
206. Calculate messages per minute
207. useStreamAnalytics hook
208. Analytics view component
209. Viewer chart
210. Chat activity chart
```

## Tier 27: P2P (Depend on Tier 7)

```
211. p2p-media-loader config
212. Tracker URLs config
213. Initialize P2P engine
214. Attach to HLS.js
215. Track peer count
216. Track upload bytes
217. Track download bytes
218. Calculate bandwidth saved
219. P2P stats component
220. Fallback on P2P failure
```

## Tier 28: Integrity (Depend on Tier 27)

```
221. Sign manifest (broadcaster)
222. Fetch signed manifest
223. Verify manifest signature
224. Hash segment
225. Verify segment hash
226. Tamper alert display
```

## Tier 29: Settings (Depend on all above)

```
227. Settings page layout
228. Monero RPC settings
229. Payment method settings
230. Stream quality defaults
231. Chat preferences
232. Notification preferences
233. Clear chat history
234. Export data
235. Import data
```

## Tier 30: Polish (Depend on all above)

```
236. Full dashboard layout
237. Sidebar navigation
238. Header component
239. Tab navigation
240. Responsive mobile layout
241. Dark/light mode
242. Loading states everywhere
243. Error boundaries
244. 404 page
245. Offline indicator
```

---

*Build in order. Test each tier before moving to next.*
