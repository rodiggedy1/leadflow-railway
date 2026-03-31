import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all new_lead cards for thumbtack-sms that don't have thumbtackUrl in metadata
const [msgs] = await conn.execute(
  `SELECT id, metadata FROM ops_chat_messages WHERE quickAction = 'new_lead' AND metadata LIKE '%thumbtack-sms%'`
);

console.log(`Found ${msgs.length} thumbtack new_lead cards`);

let updated = 0;
for (const msg of msgs) {
  let meta;
  try { meta = JSON.parse(msg.metadata ?? '{}'); } catch { continue; }

  // Skip if already has thumbtackUrl
  if (meta.thumbtackUrl) {
    console.log(`  [skip] msg ${msg.id} already has thumbtackUrl: ${meta.thumbtackUrl}`);
    continue;
  }

  const sessionId = meta.sessionId;
  if (!sessionId) {
    console.log(`  [skip] msg ${msg.id} has no sessionId`);
    continue;
  }

  // Look up the session's barkQA
  const [sessions] = await conn.execute(
    `SELECT barkQA FROM conversation_sessions WHERE id = ?`,
    [sessionId]
  );

  const session = sessions[0];
  if (!session?.barkQA) {
    console.log(`  [skip] session ${sessionId} has no barkQA`);
    continue;
  }

  // Extract URL from barkQA (e.g. "City: Bethesda | Link: thmtk.com/gYAYr1KW")
  const urlMatch = session.barkQA.match(/https?:\/\/\S+|thmtk\.com\/\S+/);
  if (!urlMatch) {
    console.log(`  [skip] session ${sessionId} barkQA has no URL: ${session.barkQA}`);
    continue;
  }

  const rawUrl = urlMatch[0];
  const thumbtackUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  meta.thumbtackUrl = thumbtackUrl;
  const newMetadata = JSON.stringify(meta);

  await conn.execute(
    `UPDATE ops_chat_messages SET metadata = ? WHERE id = ?`,
    [newMetadata, msg.id]
  );

  console.log(`  [updated] msg ${msg.id} (session ${sessionId}) → ${thumbtackUrl}`);
  updated++;
}

console.log(`\nDone. Updated ${updated} of ${msgs.length} cards.`);
await conn.end();
