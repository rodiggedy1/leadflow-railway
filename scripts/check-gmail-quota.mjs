/**
 * check-gmail-quota.mjs
 *
 * Quota health check — makes exactly ONE Gmail API call:
 *   threads.list({ userId: "me", q: "in:inbox", maxResults: 1 })
 *
 * Prints auth identity (client ID prefix, token prefix) before calling,
 * then on failure dumps the full error response.
 *
 * Usage:
 *   node scripts/check-gmail-quota.mjs
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
  // Read refresh token — env var first, then DB (mirrors production logic)
  let refreshToken = process.env.GMAIL_REFRESH_TOKEN || null;
  if (!refreshToken) {
    const conn = await createConnection(DB_URL);
    const [rows] = await conn.execute("SELECT refreshToken FROM gmail_state WHERE id = 1");
    await conn.end();
    refreshToken = rows[0]?.refreshToken ?? null;
  }

  if (!refreshToken) {
    console.error("ERROR: No refresh token found in env or gmail_state DB");
    process.exit(1);
  }

  // Print identity so we know exactly which OAuth credentials are being used
  console.log("Client ID:", CLIENT_ID.slice(0, 20) + "...");
  console.log("Refresh token:", refreshToken.slice(0, 12) + "...");

  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  // Disable Gaxios auto-retry so this health check is exactly ONE HTTP request.
  // Without this, Gaxios retries 429s up to 3 times, burning 4 quota units per check.
  const gmail = google.gmail({ version: "v1", auth, retry: false });

  console.log("\nMaking single threads.list call (maxResults: 1)...");

  try {
    const res = await gmail.users.threads.list({
      userId: "me",
      q: "in:inbox",
      maxResults: 1,
    });

    console.log("\nStatus:", res.status);
    console.log("Result: SUCCESS");
    console.log("Threads returned:", res.data.threads?.length ?? 0);
    console.log("\nQuota is healthy — safe to enable backfill.");
  } catch (err) {
    console.log("\nStatus:", err?.response?.status ?? err?.code ?? "unknown");
    console.log("Result: FAILURE");
    console.log("\n--- response.data ---");
    console.dir(err?.response?.data, { depth: null });
    console.log("\n--- response.headers ---");
    console.dir(err?.response?.headers, { depth: null });
    console.log("\n--- full error ---");
    console.dir(err, { depth: null });

    if (err?.response?.status === 429) {
      console.log("\nQuota still exhausted. Do not enable backfill yet.");
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
