# Livestream Thumbnails

This describes the repository implementation, not a claim that it is deployed.
The production gate and a real cross-client acceptance check remain required.
No database migration or Nostr signing key on the server is needed.

## Ownership and Protocol

The creator owns the thumbnail choice for `(pubkeyHex, streamId)`. NIP-53 kind
30311 uses `["image", "https://..."]`. Thumbnail updates retain the same pubkey
and `d` tag. Each signed replacement necessarily has a new event ID and newer
timestamp, not a new stream address. Planned, live and ended announcements retain
their image. Explicit opt-out omits `image` and records the dStream-specific
`["dstream:thumbnail", "off"]` preference. Other clients need only `image`.

Broadcast imports an existing announced cover when initializing a stream without
a local thumbnail record. An existing server record is authoritative: stale
draft metadata cannot reset a manual image or opt-out. Uploads and mode changes
require the current revision; competing tabs receive a conflict rather than
silently replacing a newer cover. Creator signing remains in the browser.

## Generation and Recovery

Automatic mode first publishes a stable public HTTPS URL:
`/api/thumbnail/<pubkeyHex>--<streamId>`. Before video is decodable, this redirects
to the existing dStream logo. This is a pending fallback, not a video frame.

After the publisher marks the stream live, image requests or Broadcast thumbnail
polling can trigger generation. FFmpeg selects a representative frame from a
short decoded HLS window and letterboxes it to a 640 x 360 JPEG. It reads only
the configured ingest origin, using the existing manifest-role read-only
credential in an Authorization header for playlist and segment requests. No
publisher key, stream key or service token enters the public image URL.
Successful captures are stored once, not regenerated on every view.
Near-black automatic startup frames (98% or more pixels below luma 32) are
discarded and retried instead of becoming the permanent cover. Explicit manual
covers, including deliberately black images, are exempt from that filter.

Ready images add `?v=<content-digest>` to the stable stream URL. This changes the
image cache key once when the fallback becomes a real frame, so a new signed
announcement makes clients reload instead of retaining a successfully loaded
logo. The version remains unchanged across subsequent status announcements.
Manual external URLs are not assigned automatic cache-busting parameters; their
hosting/cache policy remains the creator's responsibility.

Each decode has a 12-second timeout, bounded output/allocation and one decode
thread. At most two generation jobs run per web process; simultaneous requests
for one stream share a job. Failures retain the fallback and a persisted
30-second retry deadline. There is no permanent failure latch or new scheduler.
A later healthy request retries. A manual override, opt-out or ended transition
during decoding prevents the old result from replacing current state.

While a live Broadcast page is open, a changed revision triggers a signed
replacement announcement; relay failures retry. The stable image URL can also
acquire its first frame while the page is closed, without server-side signing.
An old event with *no image tag at all* requires its owner to reopen Broadcast
for that stream and republish: an origin cannot sign another person's kind 30311
event. This is not an unattended relay-migration service.

## Creator Controls and Privacy

Broadcast advanced settings offer automatic capture, a public HTTPS image URL,
an upload, and explicit no-thumbnail mode. Recommended input is 16:9, 1280 x 720,
JPEG/PNG/WebP up to 8 MiB. The browser reduces uploads to JPEG and the server
decodes/re-encodes them; only a normalized 640 x 360 derivative is stored. The
API caps derivatives at 2 MiB. SVG and arbitrary uploaded files are not accepted.
The upload decoder is forced to MJPEG over a pipe with no network protocols;
JPEG-disguised playlists cannot cause server-side URL fetches. Output metadata is
removed before the public derivative is stored.
Manual covers are never replaced by automatic capture unless the creator
explicitly switches back to automatic mode. Invalid remote images must be
corrected or uploaded; the server does not fetch arbitrary remote URLs.
An unsafe legacy URL retains manual ownership, shows a correction warning and
uses the public fallback until corrected. It neither blocks initialization nor
silently opts the creator into video capture.

All published thumbnails, including previews of private streams, are public.
Automatic capture of private video is disabled until the creator explicitly
checks **Allow a public frame from this private stream**. The default private
cover is a nonsensitive fallback, not an extracted video frame. Revoking that
permission or changing a public stream to private fences in-flight generation
and removes its automatic derivative from the current cover. A deliberately
supplied manual cover remains public and is preserved.
Choose no public thumbnail or a nonsensitive manual cover before publishing a
private feed if its frames must not become public. Opt-out stops future origin
image serving; it cannot erase copies already cached by relays, clients, image
proxies or an independently hosted manual-image provider.

## API, Persistence and Caching

- `GET /api/broadcast/thumbnail/:originStreamId`: current publisher settings.
- `POST` there: initialize with optional `image` / `disabled`, update `active`,
  update the current `privateStream` classification, optionally request
  `generate`. Initialization never replaces a persisted
  choice. The publisher activates/deactivates capture with live/ended.
- `PUT` there: JSON `{mode: "automatic"|"manual"|"off", image?}` or an
  `image/jpeg` body. `X-Thumbnail-Revision` must match the current revision.
  Only an explicit `privateCaptureAllowed: true` mutation permits private video
  extraction; setting it false revokes that permission.
- Settings require the existing stream-bound publisher Bearer token and return
  `no-store`. Mutations are rate-limited per publisher per process. Conflict is
  409; upload limit is 413; update-rate limit is 429.
- `GET /api/thumbnail/:originStreamId`: public JPEG, manual-image redirect,
  pending-logo redirect, or 404 when opted out. No viewer identity, cookie or
  playback entitlement is required. CORS is `*`; MIME sniffing is disabled.
- Ready JPEGs use a content-digest ETag, conditional 304 and
  `public, max-age=30, must-revalidate`. Pending fallbacks use five seconds.
  Do not add an edge rule that caches this path indefinitely or caches private
  settings. Third-party image proxies can impose their own refresh intervals.

`DSTREAM_THUMBNAIL_DIR` defaults to `/var/lib/dstream/thumbnails` on the existing
`dstream_data` volume. Each stream has atomically replaced `current.json` and
content-addressed JPEG derivatives. A short exclusive file lock protects updates;
there is no stale-lock stealing. Do not remove a lock without confirming no
writer owns it. Back up the directory with node data. Restoring it retains
manual/automatic/off preference across restarts. There is a 32-derivative limit
per stream; the operator must deliberately archive obsolete derivatives when
reached. No original recordings are deleted.

## Operator Release and Acceptance

The web runtime requires FFmpeg; the Docker runner installs it. Native runs may
set `DSTREAM_FFMPEG_PATH`. The web user needs write access to the thumbnail data
directory, `DSTREAM_HLS_PROXY_ORIGIN` must be the trusted ingest origin, and
existing `DSTREAM_MEDIA_MANIFEST_SECRET` must agree with origin authorization.
`DSTREAM_PUBLIC_ORIGIN` can pin the external HTTPS origin; otherwise the managed
proxy must preserve Host and set X-Forwarded-Proto correctly.

No live-store migration is necessary. After an approved build/deploy, open an
existing stream's Broadcast page under its owning identity, preserve its stream
ID and manual cover, and publish its current status. Verify exactly one `image`,
the same `d` and pubkey, and a newer timestamp. From an unauthenticated external
client, follow redirects and check JPEG, MIME, ETag/cache headers and TLS. Then
verify dstream.stream and zap.stream using the *same event address*, including
their image-proxy caches. Local serialization is not cross-client propagation.

Focused tests use temporary loopback HTTP ingest, actual FFmpeg HLS encoding and
decoding, genuine scoped read credentials, temporary files, real Nostr signatures
and direct route handlers. This is controlled-media evidence, not OBS, production
MediaMTX, public TLS, external relay or mounted browser/device acceptance.

## Prior Behavior / Root Cause

Pre-change canonical `f525fba` accepted an optional image URL and omitted `image`
when empty. `LiveStreamPreview` captured a browser-local data URL only after
pointer hover and never uploaded or published it. No durable live-thumbnail
generation path existed. This explains blank cross-client listings when no
manual image was supplied: automatic publication/recovery was missing from that
baseline. It is not evidence that OBS should supply NIP-53 metadata. The exact
owner event still needs a live audit to distinguish an absent tag from an
unreachable image URL. This change has not modified the production event.

References: [NIP-53](https://github.com/nostr-protocol/nips/blob/master/53.md),
[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[zap.stream image metadata](https://github.com/v0l/zap-stream-core/blob/main/docs/API.md).
