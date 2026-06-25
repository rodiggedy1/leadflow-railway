/**
 * scripts/reconcile-gmail-state.ts
 *
 * State reconciliation for isUnread and isInInbox.
 * Compares DB state against Gmail label state for active inbox rows,
 * then updates only the rows that differ.
 *
 * Usage:
 *   npx tsx scripts/reconcile-gmail-state.ts --dry-run
 *   npx tsx scripts/reconcile-gmail-state.ts --apply
 *   npx tsx scripts/reconcile-gmail-state.ts --dry-run --offset 1600 --limit 1100
 *   npx tsx scripts/reconcile-gmail-state.ts --apply  --offset 0    --limit 500
 *
 * Quota handling:
 *   - 200ms delay between batches of 20 (~6,000 req/min, under the 15k/min/user limit)
 *   - On rateLimitExceeded: pauses 60s then retries the batch once automatically
 *   - On second failure: counts as error and continues
 *
 * Scope:
 *   - Only touches isUnread and isInInbox
 *   - Never calls processThread(), enqueueThread(), or any AI function
 *   - Never touches aiCategory, aiSummary, aiUrgency, aiHistoryId, aiProcessedAt
 *   - Never touches senderName, senderEmail, subject, snippet, lastMessageAt
 *   - Uses format: "minimal" — only fetches labelIds, not messages or headers
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { gmailThreadMeta, gmailState } from "../drizzle/schema";
import { google } from "googleapis";

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isApply = args.includes("--apply");

if (!isDryRun && !isApply) {
  console.error("Usage: npx tsx scripts/reconcile-gmail-state.ts --dry-run | --apply [--offset N] [--limit N]");
  process.exit(1);
}
if (isDryRun && isApply) {
  console.error("Cannot use both --dry-run and --apply at the same time.");
  process.exit(1);
}

function getIntArg(name: string): number | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const val = parseInt(args[idx + 1] ?? "", 10);
  return isNaN(val) ? undefined : val;
}

const offsetArg = getIntArg("--offset");
const limitArg = getIntArg("--limit");

// ── DB setup ──────────────────────────────────────────────────────────────────
async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn, { mode: "default" });
}

// ── Gmail client ──────────────────────────────────────────────────────────────
async function getGmailClient(db: any) {
  const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
  if (!state?.refreshToken) throw new Error("Gmail not connected — no refresh token in DB");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: state.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err: any): boolean {
  const reason = err?.response?.data?.error?.errors?.[0]?.reason ?? "";
  return reason === "rateLimitExceeded" || reason === "userRateLimitExceeded";
}

// ── Fetch one thread's label state, with one auto-retry on rate limit ─────────
async function fetchLabels(gmail: any, threadId: string): Promise<string[] | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "minimal",
      });
      const labelIds: string[] = res.data.messages?.flatMap((m: any) => m.labelIds ?? []) ?? [];
      return labelIds;
    } catch (err: any) {
      if (isRateLimitError(err) && attempt === 1) {
        console.log(`[Recon] Rate limit hit — pausing 60s before retry (threadId=${threadId})...`);
        await sleep(60_000);
        continue; // retry
      }
      throw err; // non-rate-limit error or second failure → propagate
    }
  }
  return null; // unreachable but satisfies TS
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log(`\n[Recon] ${isDryRun ? "DRY RUN — no DB changes will be made" : "APPLY — will write changes to DB"}`);
  if (offsetArg !== undefined || limitArg !== undefined) {
    console.log(`[Recon] Slice: offset=${offsetArg ?? 0}, limit=${limitArg ?? "all"}`);
  }
  console.log("[Recon] Started\n");

  const db = await getDb();
  const gmail = await getGmailClient(db);

  // Fetch only active inbox rows
  const allRows: { threadId: string; isUnread: number; isInInbox: number }[] = await db
    .select({
      threadId: gmailThreadMeta.threadId,
      isUnread: gmailThreadMeta.isUnread,
      isInInbox: gmailThreadMeta.isInInbox,
    })
    .from(gmailThreadMeta)
    .where(eq(gmailThreadMeta.isInInbox, 1));

  // Apply --offset / --limit slicing
  const offset = offsetArg ?? 0;
  const rows = limitArg !== undefined ? allRows.slice(offset, offset + limitArg) : allRows.slice(offset);

  console.log(`[Recon] Total inbox rows in DB: ${allRows.length}`);
  console.log(`[Recon] Rows in this pass:      ${rows.length} (offset=${offset})`);
  console.log("[Recon] Fetching Gmail label state (format: minimal, 20 concurrent, 200ms between batches)...\n");

  const BATCH = 20;
  let unreadChanged = 0;
  let inboxChanged = 0;
  let alreadyCorrect = 0;
  let errors = 0;
  let rateLimitRetries = 0;
  let firstErrorLogged = false;

  // Track expected post-apply state for in-memory verification
  // key: threadId, value: { isUnread, isInInbox } as they should be after apply
  const expectedState = new Map<string, { isUnread: number; isInInbox: number }>();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (row) => {
        try {
          const labelIds = await fetchLabels(gmail, row.threadId);
          if (labelIds === null) { errors++; return; }

          const gmailUnread = labelIds.includes("UNREAD");
          const gmailInbox = labelIds.includes("INBOX");

          const dbUnread = Boolean(row.isUnread);
          const dbInbox = Boolean(row.isInInbox);

          const unreadDiffers = gmailUnread !== dbUnread;
          const inboxDiffers = gmailInbox !== dbInbox;

          if (!unreadDiffers && !inboxDiffers) {
            alreadyCorrect++;
            return;
          }

          const changes: string[] = [];
          if (unreadDiffers) changes.push(`isUnread: ${dbUnread ? 1 : 0} → ${gmailUnread ? 1 : 0}`);
          if (inboxDiffers) changes.push(`isInInbox: ${dbInbox ? 1 : 0} → ${gmailInbox ? 1 : 0}`);
          console.log(`[Recon] threadId=${row.threadId} ${changes.join(" | ")}`);

          if (unreadDiffers) unreadChanged++;
          if (inboxDiffers) inboxChanged++;

          if (isApply) {
            const updates: Record<string, any> = {};
            if (unreadDiffers) updates.isUnread = gmailUnread ? 1 : 0;
            if (inboxDiffers) updates.isInInbox = gmailInbox ? 1 : 0;
            await db
              .update(gmailThreadMeta)
              .set(updates)
              .where(eq(gmailThreadMeta.threadId, row.threadId));
            // Record expected post-apply state for verification
            expectedState.set(row.threadId, {
              isUnread: gmailUnread ? 1 : 0,
              isInInbox: gmailInbox ? 1 : 0,
            });
          }
        } catch (err: any) {
          const status = err?.response?.status ?? err?.code ?? "?";
          const reason = err?.response?.data?.error?.errors?.[0]?.reason ?? "unknown";

          if (isRateLimitError(err)) {
            rateLimitRetries++;
          }

          if (!firstErrorLogged) {
            firstErrorLogged = true;
            const data = err?.response?.data ?? {};
            const apiErrors = data?.error?.errors ?? [];
            const firstApiError = apiErrors[0] ?? {};
            console.error(`[Recon] FIRST ERROR — full payload:`);
            console.error(`  threadId:          ${row.threadId}`);
            console.error(`  response.status:   ${status}`);
            console.error(`  response.data:     ${JSON.stringify(data, null, 2)}`);
            console.error(`  errors[0].reason:  ${firstApiError.reason ?? "(none)"}`);
            console.error(`  errors[0].message: ${firstApiError.message ?? "(none)"}`);
          }
          errors++;
        }
      })
    );

    // 200ms throttle between batches (~6,000 req/min, under 15k/min/user limit)
    await sleep(200);

    // Progress indicator every 100 rows
    const processed = Math.min(i + BATCH, rows.length);
    if (processed % 100 === 0 || processed === rows.length) {
      process.stdout.write(`[Recon] Progress: ${processed}/${rows.length}\n`);
    }
  }

  const durationMs = Date.now() - startTime;
  const durationStr =
    durationMs < 60_000
      ? `${(durationMs / 1000).toFixed(1)}s`
      : `${Math.floor(durationMs / 60_000)}m${Math.floor((durationMs % 60_000) / 1000)}s`;

  // ── Post-apply verification ─────────────────────────────────────────────────
  let remainingUnreadMismatches = 0;
  let remainingInboxMismatches = 0;

  if (isApply && expectedState.size > 0) {
    const threadIds = Array.from(expectedState.keys());
    // Re-query DB for the rows we just updated
    const verifyRows: { threadId: string; isUnread: number; isInInbox: number }[] = await db
      .select({
        threadId: gmailThreadMeta.threadId,
        isUnread: gmailThreadMeta.isUnread,
        isInInbox: gmailThreadMeta.isInInbox,
      })
      .from(gmailThreadMeta)
      .where(eq(gmailThreadMeta.isInInbox, 1));

    const verifyMap = new Map(verifyRows.map((r) => [r.threadId, r]));
    for (const [tid, expected] of expectedState) {
      const actual = verifyMap.get(tid);
      if (!actual) continue;
      if (actual.isUnread !== expected.isUnread) remainingUnreadMismatches++;
      if (actual.isInInbox !== expected.isInInbox) remainingInboxMismatches++;
    }
  }

  console.log(`
[Recon] ─────────────────────────────────────────
[Recon] ${isDryRun ? "DRY RUN complete — no changes written" : "APPLY complete"}
[Recon]
[Recon] Rows scanned:    ${allRows.length} total (${rows.length} in this pass, offset=${offset})
[Recon] Updated unread:  ${unreadChanged}
[Recon] Updated inbox:   ${inboxChanged}
[Recon] Already correct: ${alreadyCorrect}
[Recon] Errors:          ${errors}
[Recon] Rate-limit pauses: ${rateLimitRetries}
[Recon] Duration:        ${durationStr}${
    isApply && expectedState.size > 0
      ? `\n[Recon]\n[Recon] Verification:\n[Recon]   Remaining unread mismatches: ${remainingUnreadMismatches}\n[Recon]   Remaining inbox mismatches:  ${remainingInboxMismatches}`
      : ""
  }
[Recon] ─────────────────────────────────────────
`);

  if (isApply && (remainingUnreadMismatches > 0 || remainingInboxMismatches > 0)) {
    console.warn(`[Recon] WARNING: ${remainingUnreadMismatches + remainingInboxMismatches} rows still mismatched after apply. Re-run --apply to retry.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[Recon] Fatal error:", err);
  process.exit(1);
});
