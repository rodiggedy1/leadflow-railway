import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);

// First find the active/pending campaign contacts queued up
// These are PENDING contacts in active reactivation campaigns OR
// the next batch that getTomorrowCampaigns would propose (reactivation_eligible from completed_jobs)
// Let's check both sources

console.log('=== SOURCE 1: PENDING contacts in reactivation_campaigns ===');
const [pending] = await conn.execute(`
  SELECT rc.id, rc.name, rc.phone, rc.campaignId, rc.discountPct,
         rc.lastPrice, rc.status
  FROM reactivation_contacts rc
  JOIN reactivation_campaigns cam ON cam.id = rc.campaignId
  WHERE rc.status = 'PENDING' AND cam.status = 'ACTIVE'
  ORDER BY rc.id
  LIMIT 50
`);
console.log(`Found ${pending.length} pending contacts in active campaigns`);

console.log('\n=== SOURCE 2: Next 50 reactivation-eligible past customers (completed_jobs) ===');
const [eligible] = await conn.execute(`
  SELECT cj.phone, cj.firstName, cj.name, cj.frequency,
         MAX(cj.jobDate) as lastBookingDate,
         COUNT(*) as totalJobs,
         MAX(cj.lastBookingPrice) as lastPrice,
         cj.reactivationEligible
  FROM completed_jobs cj
  WHERE cj.reactivationEligible = 1
    AND cj.phone NOT IN (
      SELECT DISTINCT rc.phone FROM reactivation_contacts rc
      WHERE rc.sentAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    )
  GROUP BY cj.phone, cj.firstName, cj.name, cj.frequency, cj.reactivationEligible
  ORDER BY lastBookingDate DESC
  LIMIT 50
`);

console.log(`\nFound ${eligible.length} eligible contacts. Report:\n`);
console.log('Name | Phone | Frequency | Last Booking | Total Jobs | Last Price');
console.log('-----|-------|-----------|--------------|------------|----------');
for (const r of eligible) {
  const lastBooking = r.lastBookingDate ? new Date(r.lastBookingDate).toLocaleDateString('en-US') : 'unknown';
  const freq = r.frequency || 'one-time';
  const name = r.name || r.firstName || '(no name)';
  console.log(`${name} | ${r.phone} | ${freq} | ${lastBooking} | ${r.totalJobs} jobs | $${r.lastPrice || '?'}`);
}

// Summary
const freqBreakdown = {};
for (const r of eligible) {
  const f = r.frequency || 'one-time';
  freqBreakdown[f] = (freqBreakdown[f] || 0) + 1;
}
console.log('\n=== FREQUENCY BREAKDOWN ===');
for (const [k, v] of Object.entries(freqBreakdown)) {
  console.log(`  ${k}: ${v}`);
}

await conn.end();
