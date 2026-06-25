/**
 * test-single-thread-hydration.ts
 *
 * Verifies that processThread() correctly hydrates display metadata for a
 * single legacy row in gmail_thread_meta.
 *
 * Usage:
 *   npx tsx scripts/test-single-thread-hydration.ts <threadId>
 *
 * Example:
 *   npx tsx scripts/test-single-thread-hydration.ts 18f3a1b2c3d4e5f6
 *
 * What it does:
 *   1. Reads the current row from gmail_thread_meta and prints it.
 *   2. Calls the real processThread(threadId) — the exact function the worker uses.
 *   3. Reads the row again.
 *   4. Prints which fields changed.
 *   5. Exits.
 *
 * No worker queue. No backfill. No new endpoints.
 * This exercises the exact production code path.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "../server/db";
import { gmailThreadMeta } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { processThread } from "../server/gmailGlanceWorker";

const FIELDS_TO_CHECK = [
  "senderName",
  "senderEmail",
  "subject",
  "snippet",
  "lastMessageAt",
  "isUnread",
  "messageCount",
  "aiCategory",
  "aiUrgency",
  "aiHistoryId",
] as const;

type FieldName = typeof FIELDS_TO_CHECK[number];

async function readRow(threadId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .select()
    .from(gmailThreadMeta)
    .where(eq(gmailThreadMeta.threadId, threadId));
  return row ?? null;
}

function printRow(label: string, row: Record<string, unknown> | null) {
  console.log(`\n── ${label} ──────────────────────────────`);
  if (!row) {
    console.log("  (row not found)");
    return;
  }
  for (const field of FIELDS_TO_CHECK) {
    const val = row[field];
    const display =
      val === null || val === undefined
        ? "\x1b[31mNULL\x1b[0m"
        : String(val).length > 80
        ? `"${String(val).slice(0, 77)}..."`
        : `"${val}"`;
    console.log(`  ${field.padEnd(18)} ${display}`);
  }
}

function printDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  console.log("\n── Changes ──────────────────────────────");
  if (!before || !after) {
    console.log("  Cannot diff — row missing before or after.");
    return;
  }
  let changed = 0;
  for (const field of FIELDS_TO_CHECK) {
    const bVal = before[field] ?? null;
    const aVal = after[field] ?? null;
    if (String(bVal) !== String(aVal)) {
      const bDisplay = bVal === null ? "NULL" : `"${String(bVal).slice(0, 60)}"`;
      const aDisplay = aVal === null ? "NULL" : `"${String(aVal).slice(0, 60)}"`;
      console.log(`  \x1b[33m${field.padEnd(18)}\x1b[0m  ${bDisplay}  →  \x1b[32m${aDisplay}\x1b[0m`);
      changed++;
    }
  }
  if (changed === 0) {
    console.log("  No changes detected.");
  } else {
    console.log(`\n  ${changed} field(s) updated.`);
  }
}

async function main() {
  const threadId = process.argv[2];
  if (!threadId) {
    console.error("Usage: npx tsx scripts/test-single-thread-hydration.ts <threadId>");
    process.exit(1);
  }

  console.log(`\nThread ID: ${threadId}`);

  // Step 1: Read before
  const before = await readRow(threadId);
  printRow("BEFORE processThread()", before);

  if (!before) {
    console.log("\nRow does not exist in gmail_thread_meta. processThread() will create it.");
  }

  // Step 2: Call the real worker function
  console.log("\nCalling processThread()...");
  const t0 = Date.now();
  await processThread(threadId);
  console.log(`processThread() completed in ${Date.now() - t0}ms`);

  // Step 3: Read after
  const after = await readRow(threadId);
  printRow("AFTER processThread()", after);

  // Step 4: Diff
  printDiff(before as any, after as any);

  process.exit(0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
