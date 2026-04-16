import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();
const conn = await createConnection(process.env.DATABASE_URL);

const zombieIds = [30008, 210011, 240005, 270009, 270020, 360015, 390043];
const now = new Date();

// Close all 7 zombie jobs to 'completed'
const [result] = await conn.execute(
  `UPDATE cleaner_jobs SET jobStatus = 'completed', updatedAt = ? WHERE id IN (${zombieIds.join(",")}) AND jobStatus = 'on_the_way'`,
  [now]
);
console.log(`Updated ${result.affectedRows} zombie jobs to 'completed'`);

// Also clean up their job_alerts rows so the stale_eta alerts are cleared
const [alertResult] = await conn.execute(
  `DELETE FROM job_alerts WHERE cleanerJobId IN (${zombieIds.join(",")}) AND alertType = 'stale_eta'`
);
console.log(`Deleted ${alertResult.affectedRows} stale job_alert rows`);

// Also delete the stale_eta ops_chat_messages for these jobs so they disappear from the UI
const [msgResult] = await conn.execute(
  `DELETE FROM ops_chat_messages WHERE cleanerJobId IN (${zombieIds.join(",")}) AND quickAction = 'stale_eta'`
);
console.log(`Deleted ${msgResult.affectedRows} stale_eta ops_chat_messages`);

// Verify
const [check] = await conn.execute(
  `SELECT id, customerName, jobStatus FROM cleaner_jobs WHERE id IN (${zombieIds.join(",")})`
);
console.log("Final status:");
for (const r of check) console.log(`  id=${r.id} customer=${r.customerName} status=${r.jobStatus}`);

await conn.end();
