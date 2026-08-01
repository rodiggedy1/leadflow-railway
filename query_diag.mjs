import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// 1. Check if sms_card_diag table exists and get latest rows
const [diagRows] = await conn.execute(
  `SELECT id, sessionId, draftId, insertId, affectedRows, dedupKey, diagPayload, createdAt
   FROM sms_card_diag
   ORDER BY id DESC
   LIMIT 10`
).catch(err => {
  console.log('sms_card_diag query failed:', err.message);
  return [[]];
});
console.log('=== sms_card_diag (latest 10) ===');
console.log(JSON.stringify(diagRows, null, 2));

// 2. Get the latest madison_sms_draft cards for phone 781-771-4596 (Melea)
const [cardRows] = await conn.execute(
  `SELECT o.id, o.sessionId, o.activeDedupKey, o.cardStatus, o.lastActivityAt, o.createdAt,
          JSON_UNQUOTE(JSON_EXTRACT(o.metadata, '$.draftId')) AS metaDraftId,
          JSON_UNQUOTE(JSON_EXTRACT(o.metadata, '$.sessionId')) AS metaSessionId
   FROM ops_chat_messages o
   WHERE o.quickAction = 'madison_sms_draft'
     AND o.createdAt >= '2026-07-30 23:00:00'
   ORDER BY o.id DESC
   LIMIT 10`
);
console.log('\n=== Latest madison_sms_draft cards (after 23:00 UTC) ===');
console.log(JSON.stringify(cardRows, null, 2));

await conn.end();
