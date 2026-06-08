import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);

const [campaigns] = await conn.execute(`
  SELECT id, name, status, totalContacts, sentCount, repliedCount, bookedCount, 
         batchSize, lastSentAt, createdAt
  FROM reactivation_campaigns
  ORDER BY createdAt DESC
  LIMIT 20
`);
console.log('=== CAMPAIGNS ===');
for (const c of campaigns) {
  console.log(`[${c.id}] "${c.name}" status=${c.status} total=${c.totalContacts} sent=${c.sentCount} replied=${c.repliedCount} booked=${c.bookedCount} lastSentAt=${c.lastSentAt}`);
}

const [contacts] = await conn.execute(`
  SELECT rc.campaignId, rc.status, COUNT(*) as cnt
  FROM reactivation_contacts rc
  GROUP BY rc.campaignId, rc.status
  ORDER BY rc.campaignId DESC
`);
console.log('\n=== CONTACT STATUS BY CAMPAIGN ===');
for (const c of contacts) {
  console.log(`Campaign ${c.campaignId}: ${c.status} = ${c.cnt}`);
}

await conn.end();
