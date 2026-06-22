# Gmail Inbox Cache Plan

## Problem
`listThreads` is slow on first page load because it does:
- 1 `threads.list` call to get thread IDs
- Up to 100 individual `getThreadDetail` calls in parallel

= up to 101 Gmail API calls per page load.

## Agreed Solution

### Step 1 — Fix the N+1
Replace per-thread `getThreadDetail` calls in `listInboxThreads` with a single
`threads.list` call using `format=metadata`. Gmail returns subject, sender,
snippet, date, labels, and unread status in the list call itself.

Result: 101 calls → 1 call per page load.

### Step 2 — 60-second in-memory server cache
A plain `Map` in `gmailService.ts` keyed by `query+pageToken`.
Each entry stores `{ data, cachedAt }`. TTL = 60 seconds.

Cache is **explicitly cleared** in 4 places:
1. Pub/Sub webhook fires (new inbound message) — `gmailRoutes.ts`
2. `sendReply` completes — `gmailRouter.ts`
3. `markRead` / `markUnread` completes — `gmailRouter.ts`
4. `archiveThread` completes — `gmailRouter.ts`

Result: most page loads within 60 seconds = 0 Gmail API calls.
New messages always show immediately (webhook clears cache on arrival).

## Known Gaps / Risks

1. **Multi-instance stale data**: Railway autoscale can spin up multiple instances.
   Each has its own in-memory cache. Webhook clears cache on instance A but not B.
   Instance B serves stale data for up to 60 seconds. Acceptable for current traffic.
   Fix if needed: Redis shared cache.

2. **Search bypasses cache**: Search queries change the cache key → always a miss.
   This is correct behavior. Search hits Gmail directly every time. Not a problem.

3. **`format=metadata` field audit required**: Before changing `listInboxThreads`,
   audit exactly which fields `EmailInbox.tsx` renders from the list response.
   `format=metadata` covers: subject, sender, snippet, date, labels, unread status,
   messageCount, attachments presence. Does NOT return full message bodies.
   If the list view renders anything beyond these fields, the UI will break silently.

## Files to Change
- `server/gmailService.ts` — `listInboxThreads` function + add cache Map + `clearListCache()`
- `server/gmailRoutes.ts` — call `clearListCache()` in webhook handler
- `server/gmailRouter.ts` — call `clearListCache()` in sendReply, markRead, markUnread, archiveThread

## Do NOT implement until
- Full audit of `EmailInbox.tsx` list rendering fields is complete
- User gives explicit go-ahead
