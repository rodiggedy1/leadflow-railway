import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const db = await createConnection(process.env.DATABASE_URL);

// Find their sessions
const [sessions] = await db.execute(`
  SELECT id, leadName, leadPhone, stage, leadSource, createdAt, isBooked
  FROM conversation_sessions
  WHERE leadName LIKE '%Victoria%' OR leadName LIKE '%Amber%'
  ORDER BY createdAt DESC
  LIMIT 10
`);
console.log('SESSIONS:', JSON.stringify(sessions, null, 2));

// Check their nurture enrollments
const sessionIds = sessions.map(s => s.id);
if (sessionIds.length > 0) {
  const [enrollments] = await db.execute(`
    SELECT ne.id, ne.sessionId, ne.status, ne.endReason, ne.nextSendAt, ne.enrolledAt, ne.nextStep, ne.lastStepSent
    FROM nurture_enrollments ne
    WHERE ne.sessionId IN (${sessionIds.join(',')})
  `);
  console.log('ENROLLMENTS:', JSON.stringify(enrollments, null, 2));
} else {
  console.log('No sessions found for Victoria or Amber');
}

await db.end();
