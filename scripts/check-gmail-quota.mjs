/**
 * check-gmail-quota.mjs
 *
 * Quota health check — makes exactly ONE Gmail API call:
 *   threads.list({ userId: "me", q: "in:inbox", maxResults: 1 })
 *
 * Prints:
 *   - HTTP status
 *   - Success or failure
 *   - If 429: Retry-After value (if present in response headers)
 *
 * Does NOT start the backfill. Read-only, single call.
 *
 * Usage:
 *   node scripts/check-gmail-quota.mjs
 *
 * Requires env vars:
 *   DATABASE_URL          — to read the refresh token from gmail_state
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 */

import { createConnection } from "mysql2/promise";
import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("ERROR: DATABASE_URL not set"); process.exit(1); }

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET");
  process.exit(1);
}

async function main() {
  // Read refresh token from DB (same source the worker uses)
  const conn = await createConnection(DB_URL);
  const [rows] = await conn.execute("SELECT refreshToken FROM gmail_state WHERE id = 1");
  await conn.end();

  const refreshToken = rows[0]?.refreshToken;
  if (!refreshToken) {
    console.error("ERROR: No refresh token found in gmail_state");
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  console.log("Making single threads.list call (maxResults: 1)...");

  try {
    const res = await gmail.users.threads.list({
      userId: "me",
      q: "in:inbox",
      maxResults: 1,
    });

    const status = res.status;
    const threadCount = res.data.threads?.length ?? 0;
    console.log(`\nStatus: ${status}`);
    console.log(`Result: SUCCESS`);
    console.log(`Threads returned: ${threadCount}`);
    console.log("\nQuota is healthy — Gmail API is accepting requests.");
  } catch (err) {
    const status = err?.response?.status ?? err?.code ?? "unknown";
    const retryAfter = err?.response?.headers?.["retry-after"] ?? "not provided";
    const message = err?.response?.data?.error?.message ?? err?.message ?? "unknown error";

    console.log(`\nStatus: ${status}`);
    console.log(`Result: FAILURE`);
    console.log(`Error: ${message}`);

    if (status === 429) {
      console.log(`Retry-After: ${retryAfter}`);
      console.log("\nQuota is still exhausted. Do not start the backfill yet.");
    } else {
      console.log("\nUnexpected error — not a quota issue.");
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
