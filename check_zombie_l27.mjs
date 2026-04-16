import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();
const conn = await createConnection(process.env.DATABASE_URL);

// Get the 7 zombie jobs with their bookingIds for Launch27 lookup
const [jobs] = await conn.execute(`
  SELECT id, cleanerName, customerName, jobStatus, etaTimestamp, jobDate, bookingId
  FROM cleaner_jobs
  WHERE id IN (30008, 210011, 240005, 270009, 270020, 360015, 390043)
  ORDER BY jobDate ASC
`);
console.log("Zombie jobs with bookingIds:");
for (const j of jobs) {
  const eta = j.etaTimestamp ? new Date(j.etaTimestamp).toLocaleString("en-US", {timeZone:"America/New_York"}) : "null";
  const jobDate = j.jobDate ? new Date(j.jobDate).toLocaleDateString("en-US", {timeZone:"America/New_York"}) : "null";
  console.log(`  id=${j.id} bookingId=${j.bookingId} customer=${j.customerName} cleaner=${j.cleanerName} jobDate=${jobDate} eta=${eta}`);
}
await conn.end();
