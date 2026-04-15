import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const conn = await createConnection(process.env.DATABASE_URL);

// Find all candidates who have BOTH a hiring_interview session AND a cs-inbound session
const [rows] = await conn.execute(`
  SELECT 
    c.id, c.firstName, c.lastName, c.phone,
    cs.id as session_id, cs.leadSource, cs.stage, cs.createdAt,
    LENGTH(cs.messageHistory) as msgLen
  FROM candidates c
  JOIN conversation_sessions cs ON cs.leadPhone = CONCAT('+1', REGEXP_REPLACE(c.phone, '[^0-9]', ''))
  WHERE cs.leadSource IN ('hiring_interview', 'cs-inbound')
  ORDER BY c.id, cs.createdAt
  LIMIT 100
`);

// Group by candidate
const byCandidate = {};
for (const r of rows) {
  if (!byCandidate[r.id]) byCandidate[r.id] = { name: `${r.firstName} ${r.lastName}`, phone: r.phone, sessions: [] };
  byCandidate[r.id].sessions.push({ id: r.session_id, leadSource: r.leadSource, stage: r.stage, msgLen: r.msgLen });
}

for (const [id, c] of Object.entries(byCandidate)) {
  const sources = c.sessions.map(s => s.leadSource);
  if (sources.includes('hiring_interview') && sources.includes('cs-inbound')) {
    console.log(`\n${c.name} (${c.phone}):`);
    for (const s of c.sessions) {
      console.log(`  Session ${s.id}: ${s.leadSource}, stage=${s.stage}, msgLen=${s.msgLen}`);
    }
  }
}

await conn.end();
