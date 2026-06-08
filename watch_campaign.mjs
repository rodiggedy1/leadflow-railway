import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);

console.log('Watching for new campaign blasts... (checking every 5s)');
console.log('Baseline: checking current state...\n');

const [baseline] = await conn.execute(`
  SELECT COUNT(*) as cnt, MAX(sentAt) as lastSent
  FROM reactivation_contacts
  WHERE sentAt >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
`);
console.log('Baseline (last 1hr):', baseline[0]);

let lastCount = baseline[0].cnt;
let checks = 0;

const poll = async () => {
  checks++;
  const [rows] = await conn.execute(`
    SELECT rc.id, rc.name, rc.phone, rc.status, rc.sentAt, rc.campaignId,
           cs.leadSource
    FROM reactivation_contacts rc
    LEFT JOIN conversation_sessions cs ON cs.id = rc.sessionId
    WHERE rc.sentAt >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    ORDER BY rc.sentAt DESC
    LIMIT 50
  `);

  if (rows.length !== lastCount) {
    console.log(`\n[${new Date().toLocaleTimeString()}] NEW ACTIVITY — ${rows.length} total sends in last hour (was ${lastCount})`);
    lastCount = rows.length;
    
    // Show the latest sends
    const recent = rows.slice(0, 10);
    for (const r of recent) {
      console.log(`  ${r.status} → ${r.name || '(no name)'} (${r.phone}) campaignId=${r.campaignId} sentAt=${new Date(r.sentAt).toLocaleTimeString()}`);
    }

    // Count by status
    const statusCounts = {};
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    }
    console.log('  Status breakdown:', statusCounts);
  } else {
    process.stdout.write(`\r[check ${checks}] ${rows.length} sends in last hour — waiting...`);
  }

  if (checks < 60) { // Poll for 5 minutes max
    setTimeout(poll, 5000);
  } else {
    console.log('\n\nDone polling (5 min timeout).');
    await conn.end();
  }
};

setTimeout(poll, 5000);
