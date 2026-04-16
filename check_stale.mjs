import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();
const conn = await createConnection(process.env.DATABASE_URL);

// Check the jobs that triggered stale ETA alerts at 11:25 AM today
// OnildaVillalobos — Kim Butler (ETA 3:13 PM), Laura Henry (ETA 10:12 AM), Jonathan Aries (ETA 10:30 AM)
const [jobs] = await conn.execute(`
  SELECT id, cleanerName, customerName, jobStatus, etaTimestamp, jobDate, updatedAt
  FROM cleaner_jobs
  WHERE cleanerName LIKE '%Onilda%'
  AND jobStatus = 'on_the_way'
  ORDER BY etaTimestamp ASC
`);
console.log("OnildaVillalobos on_the_way jobs:");
for (const j of jobs) {
  const eta = j.etaTimestamp ? new Date(j.etaTimestamp).toLocaleString("en-US", {timeZone:"America/New_York"}) : "null";
  const jobDate = j.jobDate ? new Date(j.jobDate).toLocaleDateString("en-US", {timeZone:"America/New_York"}) : "null";
  const updated = j.updatedAt ? new Date(j.updatedAt).toLocaleString("en-US", {timeZone:"America/New_York"}) : "null";
  console.log(`  id=${j.id} customer=${j.customerName} status=${j.jobStatus} eta=${eta} jobDate=${jobDate} updatedAt=${updated}`);
}

// Also check the job_alerts table to see what was inserted
const [alerts] = await conn.execute(`
  SELECT ja.id, ja.cleanerJobId, ja.alertType, ja.createdAt, cj.customerName, cj.jobDate, cj.etaTimestamp, cj.jobStatus
  FROM job_alerts ja
  JOIN cleaner_jobs cj ON cj.id = ja.cleanerJobId
  WHERE ja.alertType = 'stale_eta'
  ORDER BY ja.createdAt DESC
  LIMIT 10
`);
console.log("\nRecent job_alerts (stale_eta):");
for (const a of alerts) {
  const eta = a.etaTimestamp ? new Date(a.etaTimestamp).toLocaleString("en-US", {timeZone:"America/New_York"}) : "null";
  const jobDate = a.jobDate ? new Date(a.jobDate).toLocaleDateString("en-US", {timeZone:"America/New_York"}) : "null";
  const created = new Date(a.createdAt).toLocaleString("en-US", {timeZone:"America/New_York"});
  console.log(`  alertId=${a.id} jobId=${a.cleanerJobId} customer=${a.customerName} jobDate=${jobDate} eta=${eta} jobStatus=${a.jobStatus} alertCreated=${created}`);
}
await conn.end();
