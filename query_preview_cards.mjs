import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await createConnection(url);

// Find the session for 302-981-6191
const [sessions] = await conn.execute(`
  SELECT id, leadPhone, leadName, leadSource, updatedAt
  FROM conversation_sessions
  WHERE leadPhone LIKE '%3029816191%' OR leadPhone = '+13029816191'
  ORDER BY updatedAt DESC
  LIMIT 5
`);
console.log('=== Sessions for 302-981-6191 ===');
console.log(JSON.stringify(sessions, null, 2));

// Get all madison_sms_draft cards for those sessions
if (Array.isArray(sessions) && sessions.length > 0) {
  const sessionIds = sessions.map((s) => s.id);
  const placeholders = sessionIds.map(() => '?').join(',');
  const [cards] = await conn.execute(`
    SELECT id, createdAt, 
      LEFT(body, 80) as body_preview,
      metadata, quickAction, cardStatus, activeDedupKey, sessionId, lastActivityAt
    FROM ops_chat_messages
    WHERE quickAction = 'madison_sms_draft'
      AND (
        sessionId IN (${placeholders})
        OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sessionId')) IN (${placeholders})
      )
    ORDER BY id DESC
    LIMIT 20
  `, [...sessionIds, ...sessionIds]);
  console.log('\n=== madison_sms_draft cards ===');
  console.log(JSON.stringify(cards, null, 2));
}

await conn.end();
