/**
 * One-time backfill: sync isUnread state from Gmail into gmail_thread_meta
 * 
 * Steps:
 * 1. Fetch all currently unread thread IDs from Gmail (paginated)
 * 2. Reset ALL rows to isUnread = 0
 * 3. Set isUnread = 1 for confirmed unread threads
 */
import mysql from 'mysql2/promise';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('dotenv').config();

// Load refresh token from DB
async function getRefreshToken(conn) {
  const [rows] = await conn.query('SELECT refreshToken FROM gmail_state WHERE id = 1 LIMIT 1');
  if (!rows.length || !rows[0].refreshToken) throw new Error('No refresh token found in gmail_state');
  return rows[0].refreshToken;
}

async function getGmailClient(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getAllUnreadThreadIds(gmail) {
  const unreadIds = new Set();
  let pageToken = undefined;
  let page = 0;
  
  do {
    page++;
    console.log(`[Backfill] Fetching unread threads page ${page}...`);
    const res = await gmail.users.threads.list({
      userId: 'me',
      maxResults: 500,
      q: 'is:unread in:inbox',
      ...(pageToken ? { pageToken } : {}),
    });
    const threads = res.data.threads ?? [];
    for (const t of threads) unreadIds.add(t.id);
    pageToken = res.data.nextPageToken;
    console.log(`[Backfill] Page ${page}: ${threads.length} threads (total so far: ${unreadIds.size})`);
  } while (pageToken);
  
  return Array.from(unreadIds);
}

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  try {
    console.log('[Backfill] Starting isUnread backfill...');
    
    // Step 1: Get refresh token and build Gmail client
    const refreshToken = await getRefreshToken(conn);
    const gmail = await getGmailClient(refreshToken);
    
    // Step 2: Fetch all unread thread IDs from Gmail (paginated)
    const unreadIds = await getAllUnreadThreadIds(gmail);
    console.log(`[Backfill] Total unread threads in Gmail: ${unreadIds.length}`);
    
    // Step 3: Reset ALL rows to isUnread = 0
    const [resetResult] = await conn.query('UPDATE gmail_thread_meta SET isUnread = 0');
    console.log(`[Backfill] Reset ${resetResult.affectedRows} rows to isUnread = 0`);
    
    // Step 4: Set isUnread = 1 for confirmed unread threads (in batches of 100)
    if (unreadIds.length > 0) {
      let updated = 0;
      const batchSize = 100;
      for (let i = 0; i < unreadIds.length; i += batchSize) {
        const batch = unreadIds.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const [updateResult] = await conn.query(
          `UPDATE gmail_thread_meta SET isUnread = 1 WHERE threadId IN (${placeholders})`,
          batch
        );
        updated += updateResult.affectedRows;
      }
      console.log(`[Backfill] Set isUnread = 1 for ${updated} rows (${unreadIds.length - updated} unread threads not yet in gmail_thread_meta)`);
    }
    
    // Step 5: Verify final state
    const [[verify]] = await conn.query(
      "SELECT COUNT(*) as unread FROM gmail_thread_meta WHERE isUnread = 1 AND COALESCE(aiCategory, '') != 'thumbtack'"
    );
    console.log(`[Backfill] ✅ Done. Badge count will show: ${verify.unread}`);
    
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('[Backfill] FAILED:', err.message);
  process.exit(1);
});
