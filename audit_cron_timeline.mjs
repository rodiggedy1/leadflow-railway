import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();
const url = new URL(process.env.DATABASE_URL);
const conn = await createConnection({
  host: url.hostname, port: parseInt(url.port||"3306"),
  user: url.username, password: url.password,
  database: url.pathname.replace("/",""), ssl:{rejectUnauthorized:false}
});
const NOISE = ["unclaimed-lead-escalation","followup-reminders","silence-followup","nurture-send","nurture-enrollment","field-mgmt"];
const [hb] = await conn.execute(
  `SELECT jobName, resultSummary, ranAt FROM cron_heartbeats 
   WHERE ranAt >= '2026-05-03T00:00:00' 
   ORDER BY ranAt ASC`
);
for (const r of hb) {
  if (NOISE.includes(r.jobName)) continue;
  const etStr = new Date(r.ranAt).toLocaleString("en-US",{hour:"2-digit",minute:"2-digit",hour12:true,timeZone:"America/New_York"});
  console.log(`${etStr} ET | ${r.jobName.padEnd(25)} | ${(r.resultSummary??'').slice(0,100)}`);
}
await conn.end();
