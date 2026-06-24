import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await mysql.createConnection(DB_URL);

// Check Alba's session
const [rows] = await conn.execute(
  `SELECT id, leadName, leadPhone, leadSource, updatedAt,
    JSON_LENGTH(messageHistory) as msgCount
   FROM conversation_sessions
   WHERE leadName LIKE '%Alba%'
     AND (leadSource = 'cs-inbound' OR leadSource = 'cs-inbound-cleaner' OR leadSource = 'cs_initiated')
   ORDER BY updatedAt DESC LIMIT 3`
);
console.log('Alba sessions:', JSON.stringify(rows, null, 2));

if (rows.length > 0) {
  const sessionId = rows[0].id;
  const [hist] = await conn.execute(
    `SELECT messageHistory FROM conversation_sessions WHERE id = ?`, [sessionId]
  );
  const history = JSON.parse(hist[0].messageHistory ?? '[]');
  console.log('\nLast 6 messages of session', sessionId, ':');
  history.slice(-6).forEach((m, i) => {
    console.log(`  [${i}] role=${m.role} ts=${m.ts} content="${(m.content||'').substring(0,60)}" opMsgId=${m.opMsgId||'none'}`);
  });
}

// Also check the overall count the server would compute
const [allSessions] = await conn.execute(
  `SELECT id, leadName, messageHistory, lastCustomerReplyAt
   FROM conversation_sessions
   WHERE (leadSource = 'cs-inbound' OR leadSource = 'cs-inbound-cleaner' OR leadSource = 'cs_initiated')
     AND csResolvedAt IS NULL
   LIMIT 300`
);

const now = Date.now();
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
let count = 0;
let urgentCount = 0;
for (const s of allSessions) {
  try {
    const history = JSON.parse(s.messageHistory ?? '[]');
    const lastReal = [...history].reverse().find(m => m.role === 'user' || m.role === 'assistant');
    if (!lastReal || lastReal.role !== 'user') continue;
    const msgTs = lastReal.ts && lastReal.ts > 1_000_000_000_000 ? lastReal.ts : null;
    const fallbackTs = s.lastCustomerReplyAt && s.lastCustomerReplyAt > 1_000_000_000_000 ? s.lastCustomerReplyAt : null;
    const resolvedTs = msgTs ?? fallbackTs;
    if (!resolvedTs) continue;
    const age = now - resolvedTs;
    if (age > THIRTY_DAYS) continue;
    count++;
    if (age > 60 * 60 * 1000) urgentCount++;
  } catch {}
}
console.log(`\nServer would compute: count=${count}, urgentCount=${urgentCount}`);

await conn.end();
