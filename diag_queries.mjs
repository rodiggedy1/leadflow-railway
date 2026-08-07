import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// A. Any sessions updated in last 90 days
const [a] = await conn.execute(`SELECT COUNT(*) as cnt FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY`);
console.log('A. Sessions updated last 90 days:', a[0].cnt);

// B. Resolved
const [b] = await conn.execute(`SELECT COUNT(*) as cnt FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY AND csResolvedAt IS NOT NULL`);
console.log('B. Resolved:', b[0].cnt);

// C. Resolved + messageCount >= 4
const [c] = await conn.execute(`SELECT COUNT(*) as cnt FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY AND csResolvedAt IS NOT NULL AND messageCount >= 4`);
console.log('C. Resolved + messageCount>=4:', c[0].cnt);

// D. Full filter
const [d] = await conn.execute(`SELECT COUNT(*) as cnt FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY AND csResolvedAt IS NOT NULL AND messageCount >= 4 AND lastMessageRole = 'assistant'`);
console.log('D. Full filter (+ lastMessageRole=assistant):', d[0].cnt);

// lastMessageRole distribution
const [dist] = await conn.execute(`SELECT lastMessageRole, COUNT(*) AS sessions FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY GROUP BY lastMessageRole`);
console.log('lastMessageRole distribution:', dist);

// resolution distribution
const [res] = await conn.execute(`SELECT CASE WHEN csResolvedAt IS NULL THEN 'not_resolved' ELSE 'resolved' END AS resolution, COUNT(*) AS sessions FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY GROUP BY resolution`);
console.log('Resolution distribution:', res);

// 5 recent sessions without quality filters
const [sample] = await conn.execute(`SELECT id, updatedAt, csResolvedAt, messageCount, lastMessageRole, LENGTH(messageHistory) AS historyBytes FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 90 DAY AND messageHistory IS NOT NULL ORDER BY updatedAt DESC LIMIT 5`);
console.log('5 recent sessions:', JSON.stringify(sample, null, 2));

// Parse messageHistory for those 5
for (const row of sample) {
  try {
    const msgs = JSON.parse((await conn.execute(`SELECT messageHistory FROM conversation_sessions WHERE id = ?`, [row.id]))[0][0].messageHistory || '[]');
    const userMsgs = msgs.filter(m => m.role === 'user').length;
    const agentMsgs = msgs.filter(m => m.role === 'assistant').length;
    let pairs = 0;
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === 'user' && msgs[i+1].role === 'assistant') pairs++;
    }
    console.log(`Session ${row.id}: user=${userMsgs} agent=${agentMsgs} pairs=${pairs}`);
  } catch(e) { console.log(`Session ${row.id}: parse error`, e.message); }
}

await conn.end();
