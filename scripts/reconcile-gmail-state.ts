/**
 * scripts/reconcile-gmail-state.ts
 *
 * One-time (or on-demand) state reconciliation for isUnread and isInInbox.
 *
 * Compares DB state against Gmail label state for every active inbox row,
 * then updates only the rows that differ.
 *
 * Usage:
 *   npx tsx scripts/reconcile-gmail-state.ts --dry-run   (preview only, no DB writes)
 *   npx tsx scripts/reconcile-gmail-state.ts --apply     (write changes to DB)
 *
 * Scope:
 *   - Only touches isUnread and isInInbox
 *   - Never calls processThread(), enqueueThread(), or any AI function
 *   - Never touches aiCategory, aiSummary, aiUrgency, aiHistoryId, aiProcessedAt
 *   - Never touches senderName, senderEmail, subject, snippet, lastMessageAt
 *   - Uses format: "minimal" — only fetches labelIds, not messages or headers
 *   - 20 concurrent Gmail requests (same as worker)
 *   - Skips rows where isInInbox = 0 (archived rows are not worth reconciling)
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import { gmailThreadMeta, gmailState } from "../drizzle/schema";
import { google } from "googleapis";

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isApply = args.includes("--apply");

if (!isDryRun && !isApply) {
  console.error("Usage: npx tsx scripts/reconcile-gmail-state.ts --dry-run | --apply");
  process.exit(1);
}

if (isDryRun && isApply) {
  console.error("Cannot use both --dry-run and --apply at the same time.");
  process.exit(1);
}

// ── DB setup ──────────────────────────────────────────────────────────────────
async function getDb() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  return drizzle(conn, { mode: "default" });
}

// ── Gmail client ──────────────────────────────────────────────────────────────
async function getGmailClient(db: ReturnType<typeof drizzle>) {
  const [state] = await (db as any).select().from(gmailState).where(eq(gmailState.id, 1));
  if (!state?.refreshToken) throw new Error("Gmail not connected — no refresh token in DB");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: state.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log(`\n[Recon] ${isDryRun ? "DRY RUN — no DB changes will be made" : "APPLY — will write changes to DB"}`);
  console.log("[Recon] Started\n");

  const db = await getDb();
  const gmail = await getGmailClient(db as any);

  // Fetch only active inbox rows — no point reconciling archived history
  const rows = await (db as any)
    .select({
      threadId: gmailThreadMeta.threadId,
      isUnread: gmailThreadMeta.isUnread,
      isInInbox: gmailThreadMeta.isInInbox,
    })
    .from(gmailThreadMeta)
    .where(eq(gmailThreadMeta.isInInbox, 1));

  console.log(`[Recon] Rows scanned: ${rows.length}`);
  console.log("[Recon] Fetching Gmail label state (format: minimal, 20 concurrent)...\n");

  const BATCH = 20;
  let unreadChanged = 0;
  let inboxChanged = 0;
  let alreadyCorrect = 0;
  let errors = 0;
  let firstErrorLogged = false;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (row: { threadId: string; isUnread: number; isInInbox: number }) => {
        try {
          const res = await (gmail.users.threads.get as any)({
            userId: "me",
            id: row.threadId,
            format: "minimal",
          });

          const labelIds: string[] = res.data.messages?.flatMap((m: any) => m.labelIds ?? []) ?? [];
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

          // Log only changed rows
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

            await (db as any)
              .update(gmailThreadMeta)
              .set(updates)
              .where(eq(gmailThreadMeta.threadId, row.threadId));
          }
        } catch (err: any) {
          const status = err?.response?.status ?? err?.code ?? "?";
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
          } else {
            // Suppress duplicate error logs — only count them
          }
          errors++;
        }
      })
    );

    // Throttle: 200ms between batches → ~100 req/s → ~6,000/min, well under the 15,000/min/user limit
    await new Promise((r) => setTimeout(r, 200));

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

  console.log(`
[Recon] ─────────────────────────────────────────
[Recon] ${isDryRun ? "DRY RUN complete — no changes written" : "APPLY complete"}
[Recon]
[Recon] Rows scanned:    ${rows.length}
[Recon] Updates:
[Recon]   isUnread:      ${unreadChanged} changed
[Recon]   isInInbox:     ${inboxChanged} changed
[Recon]   Already correct: ${alreadyCorrect}
[Recon]   Errors:        ${errors}
[Recon] Duration:        ${durationStr}
[Recon] ─────────────────────────────────────────
`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[Recon] Fatal error:", err);
  process.exit(1);
});
