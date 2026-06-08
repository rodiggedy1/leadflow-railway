import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('DB host:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0]);

// Who was actually sent today (sessions created after the blast started ~23:36 UTC)
const [sent] = await conn.execute(
  "SELECT leadPhone, leadName FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND createdAt >= '2026-05-18 23:36:00' GROUP BY leadPhone, leadName ORDER BY MIN(createdAt) ASC"
);
const sentPhones = new Set(sent.map(r => r.leadPhone));
console.log('\nSENT (' + sentPhones.size + ' unique phones):');
sent.forEach((r, i) => console.log((i+1) + ':', r.leadName, r.leadPhone));

// The full 50-person list (deduplicated by phone, sorted by most recent jobDate)
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

console.log('\nNOT SENT from this batch (in top 50 but no session created today):');
let num = 0;
eligible.forEach((r, i) => {
  if (!sentPhones.has(r.phone)) {
    num++;
    console.log(num + ':', r.name, '|', r.phone, '|', r.jobDate);
  }
});
console.log('\nTotal unsent:', num);

await conn.end();
