import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// 1. SHOW CREATE TABLE
const [[createRow]] = await conn.execute('SHOW CREATE TABLE ops_chat_messages');
console.log('=== SHOW CREATE TABLE ===');
console.log(createRow['Create Table']);

// 2. Check triggers on ops_chat_messages
const [triggers] = await conn.execute(
  "SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_TABLE = 'ops_chat_messages' AND TRIGGER_SCHEMA = DATABASE()"
);
console.log('\n=== TRIGGERS ===');
console.log(JSON.stringify(triggers, null, 2));

// 3. The two duplicate rows from today's test (ids 20221464, 20221478, 20221481)
// Plus check their individual draftId, authorName, createdAt, sessionId, activeDedupKey
const [rows] = await conn.execute(
  `SELECT id, channel, authorName, authorRole, quickAction, metadata, sessionId, activeDedupKey, cardStatus, lastActivityAt, createdAt
   FROM ops_chat_messages
   WHERE id IN (20221464, 20221478, 20221481)
   ORDER BY id`
);
console.log('\n=== DUPLICATE ROWS ===');
console.log(JSON.stringify(rows, null, 2));

// 4. Check if there are any other rows for session 1170002 with madison_sms_draft created today
const [allToday] = await conn.execute(
  `SELECT id, channel, authorName, authorRole, quickAction, metadata, sessionId, activeDedupKey, cardStatus, createdAt
   FROM ops_chat_messages
   WHERE quickAction = 'madison_sms_draft'
     AND createdAt >= '2026-07-30 20:00:00'
   ORDER BY id`
);
console.log('\n=== ALL SMS DRAFT CARDS TODAY (after 20:00 UTC) ===');
console.log(JSON.stringify(allToday, null, 2));

await conn.end();
