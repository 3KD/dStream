# App Store / Play UGC Compliance Matrix

Last updated: 2026-02-16

Purpose: map Apple + Google user-generated-content (UGC) moderation requirements to the current dStream implementation, with concrete close-out actions before store submission.

This is product/engineering guidance, not legal advice.

## Policy baseline (submission risk)

- Apple App Review Guidelines `1.2` (UGC apps): needs filtering controls, report path, block capability, and operator contact.
- Google Play UGC policy: needs in-app reporting, blocking, terms/prohibited-content policy, and active enforcement.

## Current implementation map

### Implemented now (low risk)

1. **User blocking + muting (local controls)**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/app/settings/page.tsx` (`Trust & Blocks` section)
     - `apps/web/src/components/chat/ChatBox.tsx` (local + relay mute/block filtering)
     - `apps/web/app/browse/BrowseClient.tsx` (blocked creators filtered from browse)

2. **Broadcaster/moderator stream-level moderation**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/src/components/chat/ChatMessage.tsx` (mute/block/mod/sub controls)
     - `apps/web/src/components/chat/ChatBox.tsx` (`publishModerationAction`, role toggles)
     - `apps/web/app/moderation/page.tsx` (moderation control surface)

3. **Operational moderation data plane**
   - Status: ✅ Implemented
   - Evidence:
     - Relay-backed moderation/roles are documented and wired through chat filtering.
     - `apps/web/app/docs/page.tsx` (Nostr event + moderation notes)

4. **Content responsibility disclaimer**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/src/components/layout/SiteFooter.tsx` (node-operator responsibility notice)

5. **Creator-controlled discovery visibility**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/app/broadcast/page.tsx` (`List this stream in public discovery` toggle)
     - `packages/protocol/src/stream.ts` (`discoverable` announce tag)
     - `apps/web/src/hooks/useStreamAnnounces.ts` (hidden-from-discovery filtering on home/browse)

### Remaining / partial (submission blockers)

1. **In-app abuse reporting (stream/message/user)**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/app/browse/BrowseClient.tsx` (report stream button + modal)
     - `apps/web/app/watch/[pubkey]/[streamId]/page.tsx` (report stream + report creator actions)
     - `apps/web/src/components/chat/ChatMessage.tsx` + `apps/web/src/components/chat/ChatBox.tsx` (report user/message flow)
     - `apps/web/app/api/moderation/reports/route.ts` (report intake + list + update actions)

2. **Public policy pages (Terms/Community/Privacy)**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/app/terms/page.tsx`
     - `apps/web/app/privacy/page.tsx`
     - `apps/web/app/community-guidelines/page.tsx`
     - Footer/header links wired in `apps/web/src/components/layout/SiteFooter.tsx` and `apps/web/src/components/layout/SimpleHeader.tsx`

3. **Operator enforcement workflow**
   - Status: ✅ Implemented
   - Evidence:
     - `apps/web/app/moderation/page.tsx` (report inbox + triage status transitions + "Hide on Official Discovery")
     - `apps/web/app/api/moderation/reports/route.ts` + `apps/web/src/lib/moderation/reportStore.ts` (queue persistence + action tracking)

4. **Age/content safety controls**
   - Status: ✅ Implemented
   - Evidence:
     - `packages/protocol/src/stream.ts` + `packages/protocol/src/types.ts` (`mature` announce tag support)
     - `apps/web/app/broadcast/page.tsx` (mature content toggle on announce)
     - `apps/web/src/lib/social/store.ts` + `apps/web/app/settings/page.tsx` (viewer mature-content preference)
     - `apps/web/src/hooks/useStreamAnnounces.ts`, `apps/web/app/page.tsx`, `apps/web/app/browse/BrowseClient.tsx` (discovery filtering + badges)

5. **Store-facing safety metadata package**
   - Status: ⚠️ Partial
   - Existing:
     - Mobile release automation and build/upload scripts exist.
   - Gap:
     - Safety policy artifacts are not bundled as submission-ready docs/forms.

## P0 close-out tasks before App Store / Play submission

1. **Finalize and verify in-app report actions**
   - Confirm report actions across watch/chat/browse on iOS + Android real devices.
   - Confirm operator triage and hide actions through Moderation inbox.

2. **Finalize moderation SOP + escalation runbook**
   - Define triage SLA and escalation steps for abuse categories.
   - Capture operator workflow screenshots for store reviewer packet.

3. **Verify policy URLs in production**
   - `/privacy`, `/terms`, `/community-guidelines`
   - Ensure public access over production domain and app-webview pathing.

4. **Package store safety metadata**
   - Keep privacy labels / data-safety forms synchronized with implemented behavior.

5. **Dry-run reviewer journey**
   - Script: report content → operator action → verify discovery hide behavior.

## P1 (strongly recommended)

1. **Appeal/review path**
   - Add a lightweight appeal flow for moderated users.

2. **SLA + monitoring**
   - Add report queue metrics and alerting (backlog age, unresolved critical reports).

3. **Store readiness artifact bundle**
   - Single folder with:
     - policy URLs
     - moderation SOP
     - escalation contact
     - screenshots of report/block flows
     - reviewer test credentials/steps

## “Ready to submit” definition

Do not submit mobile builds until all are true:

1. Report actions exist in-app and are functional.
2. Terms/Privacy/Guidelines URLs are live and linked in-app.
3. Operator can action reports and hide abusive content from official app-indexed surfaces.
4. Block/mute/report flows verified on iOS + Android test devices.
5. Submission metadata (Data Safety / App Privacy / content rating) matches actual behavior.
