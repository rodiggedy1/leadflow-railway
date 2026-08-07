import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Find candidate sessions (same query as the fixed enrichment)
const [sessions] = await conn.execute(`
  SELECT id, messageHistory
  FROM conversation_sessions
  WHERE csResolvedAt IS NOT NULL
    AND messageCount >= 4
    AND updatedAt >= NOW() - INTERVAL 90 DAY
  ORDER BY updatedAt DESC
  LIMIT 10
`);
console.log(`Found ${sessions.length} candidate sessions`);

// Step 2: Extract pairs from first session
if (sessions.length > 0) {
  const s = sessions[0];
  console.log(`Session ${s.id}, historyLen=${s.messageHistory?.length}`);
  let msgs = [];
  try { msgs = JSON.parse(s.messageHistory || '[]'); } catch(e) { console.log('parse error:', e.message); }
  console.log(`Total messages: ${msgs.length}`);
  
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoffTs = Date.now() - NINETY_DAYS_MS;
  
  let pairs = 0;
  for (let i = 0; i < msgs.length - 1; i++) {
    const m = msgs[i];
    const next = msgs[i+1];
    if (m.role === 'user' && next.role === 'assistant') {
      const ts = m.ts ?? 0;
      if (ts >= cutoffTs && m.content?.trim() && next.content?.trim() && next.content.length >= 20 && next.content.length <= 500) {
        pairs++;
        if (pairs <= 2) console.log(`  Pair ${pairs}: user="${m.content.slice(0,50)}" agent="${next.content.slice(0,50)}"`);
      }
    }
  }
  console.log(`Valid pairs in session ${s.id}: ${pairs}`);
}

// Step 3: Check if cs_draft_examples table exists
try {
  const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM cs_draft_examples`);
  console.log(`cs_draft_examples row count: ${rows[0].cnt}`);
} catch(e) {
  console.log(`cs_draft_examples error: ${e.message}`);
}

await conn.end();
