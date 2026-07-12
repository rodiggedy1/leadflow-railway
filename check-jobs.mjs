import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

const today = new Date().toISOString().slice(0, 10);

// All jobs for fake rohan team today
const [jobs] = await db.execute(
  `SELECT id, serviceDateTime, jobStatus, bookingStatus FROM cleaner_jobs WHERE jobDate = ? AND bookingStatus NOT IN ('cancelled','rescheduled') ORDER BY serviceDateTime`,
  [today]
);
console.log("Jobs today:", JSON.stringify(jobs, null, 2));

const jobIds = jobs.map(j => j.id);
console.log("Job IDs:", jobIds);

if (jobIds.length > 0) {
  const placeholders = jobIds.map(() => "?").join(",");
  const [cards] = await db.execute(
    `SELECT cleanerJobId, quickAction, createdAt, LEFT(metadata, 200) as meta_preview FROM ops_chat_messages WHERE cleanerJobId IN (${placeholders}) AND quickAction = 'eta_call_result' ORDER BY createdAt DESC`,
    jobIds
  );
  console.log("ETA cards:", JSON.stringify(cards, null, 2));
}

await db.end();
