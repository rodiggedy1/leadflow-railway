import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);

// Check recent command center campaign blasts (campaignId = -1)
const [recent] = await conn.execute(`
  SELECT id, campaignId, name, phone, status, sentAt, sessionId
  FROM reactivation_contacts
  WHERE campaignId = -1
  ORDER BY sentAt DESC
  LIMIT 10
`);
console.log('=== RECENT COMMAND CENTER BLASTS (last 10) ===');
for (const r of recent) {
  console.log(`[${r.id}] ${r.name} (${r.phone}) status=${r.status} sentAt=${r.sentAt}`);
}

// Check if there are any recent blasts today
const [today] = await conn.execute(`
  SELECT COUNT(*) as cnt, MAX(sentAt) as lastSent
  FROM reactivation_contacts
  WHERE campaignId = -1 AND sentAt >= CURDATE()
`);
console.log('\n=== TODAY\'S BLASTS ===');
console.log(today[0]);

// Check the getTomorrowCampaigns data - look at completed_jobs for tomorrow
const [tomorrow] = await conn.execute(`
  SELECT COUNT(*) as eligible
  FROM completed_jobs
  WHERE reactivationEligible = 1
  LIMIT 1
`);
console.log('\n=== REACTIVATION ELIGIBLE JOBS ===');
console.log(tomorrow[0]);

await conn.end();
