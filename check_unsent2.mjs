import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Raw: all campaign sessions from today's blast window
const [rawSent] = await conn.execute(
  "SELECT id, leadPhone, leadName, createdAt FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND createdAt >= '2026-05-18 23:00:00' ORDER BY createdAt ASC"
);
console.log('RAW sessions found:', rawSent.length);
rawSent.forEach(r => console.log(' ', r.createdAt, r.leadName, r.leadPhone));

// Build sent set (exclude Terry's test sends at 23:09)
const sentPhones = new Set(
  rawSent
    .filter(r => r.createdAt >= new Date('2026-05-18T23:36:00Z'))
    .map(r => r.leadPhone)
);
console.log('\nSent phones (blast only, excl Terry test):', sentPhones.size);

// Full eligible top-50 list
const [eligible] = await conn.execute(`
  SELECT cj.name, cj.phone, cj.jobDate
  FROM completed_jobs cj
  INNER JOIN (
    SELECT phone, MAX(jobDate) AS maxJobDate
    FROM completed_jobs
    WHERE reactivationEligible = 1
    GROUP BY phone
  ) latest ON cj.phone = latest.phone AND cj.jobDate = latest.maxJobDate
  WHERE cj.reactivationEligible = 1
    AND cj.phone NOT IN (SELECT phone FROM sms_opt_outs)
  ORDER BY cj.jobDate DESC
  LIMIT 50
`);

// Deduplicate eligible by phone (keep first occurrence = most recent job)
const seen = new Set();
const dedupedEligible = [];
for (const r of eligible) {
  if (!seen.has(r.phone)) {
    seen.add(r.phone);
    dedupedEligible.push(r);
  }
}

console.log('\n--- SENT (from this batch) ---');
let sentNum = 0;
dedupedEligible.forEach((r, i) => {
  if (sentPhones.has(r.phone)) {
    sentNum++;
    console.log(sentNum + ':', r.name, '|', r.phone);
  }
});

console.log('\n--- NOT SENT (missed) ---');
let unsentNum = 0;
dedupedEligible.forEach((r, i) => {
  if (!sentPhones.has(r.phone)) {
    unsentNum++;
    console.log(unsentNum + ':', r.name, '|', r.phone, '|', r.jobDate);
  }
});

console.log('\nSent:', sentNum, '| Unsent:', unsentNum, '| Total eligible:', dedupedEligible.length);

await conn.end();
