import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// All phones sent today (any campaign:tomorrow_slots session)
const [sentRows] = await conn.execute(
  "SELECT DISTINCT leadPhone FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND DATE(createdAt) = '2026-05-18'"
);
const sentPhones = new Set(sentRows.map(r => r.leadPhone));
console.log('Already sent today:', sentPhones.size, 'phones');

// Full eligible pool deduped by phone, sorted by most recent job date
const [eligible] = await conn.execute(`
  SELECT cj.name, cj.firstName, cj.phone, cj.jobDate, cj.lastBookingPrice, cj.serviceType, cj.frequency
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
  LIMIT 200
`);

// Deduplicate by phone
const seen = new Set();
const deduped = [];
for (const r of eligible) {
  if (!seen.has(r.phone)) {
    seen.add(r.phone);
    deduped.push(r);
  }
}

// Skip already-sent, take next 50
const next50 = deduped.filter(r => !sentPhones.has(r.phone)).slice(0, 50);

console.log('\nNEXT 50 to send:');
next50.forEach((r, i) => console.log((i+1) + ':', r.name, '|', r.phone, '|', r.jobDate));
console.log('\nTotal:', next50.length);

await conn.end();
