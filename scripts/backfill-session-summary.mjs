/**
 * backfill-session-summary.mjs
 *
 * One-time idempotent backfill: populates the 5 inbox summary columns
 * (lastMessageText, lastMessageTs, lastCustomerMessageTs, lastMessageRole,
 * messageCount) for every conversationSessions row where they haven't
 * already been set (lastMessageTs IS NULL).
 *
 * Safe to re-run: only processes rows where lastMessageTs IS NULL.
 *
 * Usage:
 *   node scripts/backfill-session-summary.mjs
 */

import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL env var is not set.");
  process.exit(1);
}

function computeSummary(messageHistoryJson) {
  let messages = [];
  try {
    messages = JSON.parse(messageHistoryJson ?? "[]");
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
  }

  const count = messages.length;
  if (count === 0) {
    return { lastMessageText: null, lastMessageTs: null, lastCustomerMessageTs: null, lastMessageRole: null, messageCount: 0 };
  }

  const last = messages[count - 1];
  const rawText = typeof last.content === "string" ? last.content : "";
  const lastMessageText = rawText.slice(0, 255) || null;
  const lastMessageTs = last.ts ?? null;
  const lastMessageRole = last.role ?? null;

  let lastCustomerMessageTs = null;
  for (let i = count - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].ts != null) {
      lastCustomerMessageTs = messages[i].ts;
      break;
    }
  }

  return { lastMessageText, lastMessageTs, lastCustomerMessageTs, lastMessageRole, messageCount: count };
}

async function main() {
  const conn = await createConnection(DATABASE_URL);
  console.log("Connected to database.");

  // Count rows that need backfilling
  const [[{ total }]] = await conn.execute(
    "SELECT COUNT(*) AS total FROM conversation_sessions WHERE lastMessageTs IS NULL"
  );
  console.log(`Rows to backfill: ${total}`);

  if (total === 0) {
    console.log("Nothing to do — all rows already have summary fields.");
    await conn.end();
    return;
  }

  const BATCH_SIZE = 200;
  let offset = 0;
  let processed = 0;
  let skipped = 0;

  while (true) {
    const [rows] = await conn.execute(
      `SELECT id, messageHistory FROM conversation_sessions WHERE lastMessageTs IS NULL LIMIT ${BATCH_SIZE}`
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      const summary = computeSummary(row.messageHistory);

      if (summary.messageCount === 0) {
        // Empty history — set lastMessageTs = 0 as a sentinel so this row
        // is not re-selected by the WHERE lastMessageTs IS NULL condition.
        await conn.execute(
          `UPDATE conversation_sessions
           SET messageCount = 0,
               lastMessageText = NULL,
               lastMessageTs = 0,
               lastCustomerMessageTs = NULL,
               lastMessageRole = NULL
           WHERE id = ?`,
          [row.id]
        );
        skipped++;
      } else {
        await conn.execute(
          `UPDATE conversation_sessions
           SET lastMessageText = ?,
               lastMessageTs = ?,
               lastCustomerMessageTs = ?,
               lastMessageRole = ?,
               messageCount = ?
           WHERE id = ?`,
          [
            summary.lastMessageText,
            summary.lastMessageTs,
            summary.lastCustomerMessageTs,
            summary.lastMessageRole,
            summary.messageCount,
            row.id,
          ]
        );
        processed++;
      }
    }

    offset += rows.length;
    console.log(`  Progress: ${offset} rows processed so far (${processed} updated, ${skipped} empty)...`);
  }

  console.log(`\nBackfill complete.`);
  console.log(`  Updated with summary data: ${processed}`);
  console.log(`  Empty history (no messages): ${skipped}`);
  console.log(`  Total processed: ${processed + skipped}`);

  await conn.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
