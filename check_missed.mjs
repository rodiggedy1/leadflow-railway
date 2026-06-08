import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/leadflow-railway/.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [sent] = await conn.execute(
  "SELECT DISTINCT leadPhone FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND createdAt > '2026-05-18 23:30:00'"
);
const sentPhones = new Set(sent.map(r => r.leadPhone));
console.log('Sent to', sentPhones.size, 'unique phones today');

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
  LIMIT 55
`);

console.log('\nMISSED (in top 50 but not sent today):');
let missedCount = 0;
eligible.slice(0, 50).forEach((r, i) => {
  if (!sentPhones.has(r.phone)) {
    missedCount++;
    console.log(i+1, r.name, r.phone, r.jobDate);
  }
});
console.log('Total missed:', missedCount);

await conn.end();
