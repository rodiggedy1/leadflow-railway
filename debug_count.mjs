import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [allSessions] = await conn.execute(
  `SELECT id, leadName, leadPhone, messageHistory, lastCustomerReplyAt
   FROM conversation_sessions
   WHERE (leadSource = 'cs-inbound' OR leadSource = 'cs-inbound-cleaner' OR leadSource = 'cs_initiated')
     AND csResolvedAt IS NULL
   LIMIT 300`
);

const now = Date.now();
const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let count = 0;
let urgentCount = 0;
const unanswered = [];

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
    if (age > THIRTY_DAYS_MS) continue;
    count++;
    if (age > ONE_HOUR_MS) urgentCount++;
    unanswered.push({
      id: s.id,
      name: s.leadName,
      lastMsg: (lastReal.content || '').substring(0, 50),
      ageHours: Math.round(age / 3600000 * 10) / 10,
      lastRole: lastReal.role,
      histLen: history.length,
      lastRealIdx: history.length - 1 - [...history].reverse().findIndex(m => m.role === 'user' || m.role === 'assistant'),
    });
  } catch {}
}

console.log(`Total unanswered: ${count}, urgent (>1h): ${urgentCount}`);
console.log('\nFirst 20 unanswered sessions:');
unanswered.slice(0, 20).forEach(s => {
  console.log(`  id=${s.id} name="${s.name}" ageH=${s.ageHours} histLen=${s.histLen} lastRealIdx=${s.lastRealIdx} msg="${s.lastMsg}"`);
});

// Check specifically: how many sessions have lastReal at index < histLen-1 (meaning there are messages AFTER the last user msg)
const withTrailingMessages = unanswered.filter(s => s.lastRealIdx < s.histLen - 1);
console.log(`\nSessions where lastReal is NOT the final message (has trailing entries): ${withTrailingMessages.length}`);
withTrailingMessages.slice(0, 5).forEach(s => {
  console.log(`  id=${s.id} name="${s.name}" histLen=${s.histLen} lastRealIdx=${s.lastRealIdx}`);
});

await conn.end();
