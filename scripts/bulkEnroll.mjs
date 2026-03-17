/**
 * bulkEnroll.mjs
 *
 * Fast bulk enrollment script with phone-level deduplication.
 *
 * Key rule: each unique phone number appears ONCE in always_on_enrollments,
 * classified based on their MOST RECENT booking job date and frequency.
 *
 * Logic:
 * 1. For each unique phone, pick the row with the latest jobDate
 * 2. Classify that row into one of the 4 groups (or skip if active recurring)
 * 3. Insert one enrollment row per phone (IGNORE duplicates)
 *
 * Usage:
 *   node scripts/bulkEnroll.mjs
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const TODAY = new Date();
const NOW_MS = TODAY.getTime();

// ── Frequency window mapping (days) ──────────────────────────────────────────
function getWindowDays(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase().trim();
  // Order matters: check more specific patterns first
  if (f.includes("every other week") || f.includes("bi-weekly") || f.includes("biweekly") || f.includes("bi weekly") || f.includes("every 2 week")) return 14;
  if (f.includes("tri-weekly") || f.includes("triweekly") || f.includes("tri weekly") || f.includes("every 3 week") || f.includes("3 week")) return 21;
  if (f.includes("every 6 week") || f.includes("6 week")) return 42;
  if (f.includes("every 8 week") || f.includes("8 week") || f.includes("bimonthly") || f.includes("bi-monthly")) return 56;
  if (f.includes("quarter") || f.includes("every 3 month")) return 90;
  if (f.includes("month")) return 30;
  // Weekly — only if none of the above matched
  if (f.includes("week")) return 7;
  return null;
}

function isRecurring(freq) {
  if (!freq) return false;
  const f = freq.toLowerCase().trim();
  if (f === "one-time" || f === "one time" || f === "onetime" || f === "1 time") return false;
  return getWindowDays(freq) !== null;
}

function computeGroup(jobDateStr, frequency) {
  if (!jobDateStr) return null;
  const jobDate = new Date(jobDateStr + "T00:00:00Z");
  if (isNaN(jobDate.getTime())) return null;

  const daysSince = Math.floor((NOW_MS - jobDate.getTime()) / (1000 * 60 * 60 * 24));
  const recurring = isRecurring(frequency);
  const windowDays = recurring ? getWindowDays(frequency) : null;

  // Active recurring — NEVER enroll
  if (recurring && windowDays !== null && daysSince < windowDays + 7) return null;

  // Group 4: Dormant (6+ months, any frequency)
  if (daysSince >= 180) return "dormant";

  // Group 3: Lapsed Recurring (past their window + 7-day buffer, but < 6 months)
  if (recurring && windowDays !== null && daysSince >= windowDays + 7) return "lapsed-recurring";

  // Group 2: Lapsed One-Time (21+ days, never rebooked)
  if (!recurring && daysSince >= 21) return "lapsed-one-time";

  // Group 1: New One-Time (3–20 days after first cleaning)
  if (!recurring && daysSince >= 3 && daysSince < 21) return "new-one-time";

  return null;
}

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected to database");

  // Get group IDs
  const [groups] = await db.execute("SELECT id, groupType FROM always_on_groups");
  const groupMap = {};
  for (const g of groups) groupMap[g.groupType] = g.id;
  console.log("Groups:", groupMap);

  // Fetch ONE row per unique phone — the most recent booking
  console.log("Fetching most recent booking per unique phone...");
  const [jobs] = await db.execute(`
    SELECT cj.id, cj.phone, cj.name, cj.firstName, cj.frequency, cj.jobDate, cj.lastBookingPrice
    FROM completed_jobs cj
    INNER JOIN (
      SELECT phone, MAX(jobDate) as latestDate
      FROM completed_jobs
      WHERE phone IS NOT NULL AND phone != ''
      GROUP BY phone
    ) latest ON cj.phone = latest.phone AND cj.jobDate = latest.latestDate
    -- If two rows share the same phone + max date, pick the one with the highest id
    INNER JOIN (
      SELECT phone, MAX(id) as maxId
      FROM completed_jobs
      WHERE phone IS NOT NULL AND phone != ''
      GROUP BY phone
    ) dedup ON cj.id = dedup.maxId
  `);
  console.log(`Fetched ${jobs.length} unique customers (phones)`);

  // Classify
  const buckets = {
    "new-one-time": [],
    "lapsed-one-time": [],
    "lapsed-recurring": [],
    dormant: [],
  };

  let skipped = 0;
  for (const job of jobs) {
    const group = computeGroup(job.jobDate, job.frequency);
    if (!group) { skipped++; continue; }
    buckets[group].push(job);
  }

  const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
  console.log(`\nClassification (unique customers):`);
  console.log(`  New One-Time:      ${buckets["new-one-time"].length}`);
  console.log(`  Lapsed One-Time:   ${buckets["lapsed-one-time"].length}`);
  console.log(`  Lapsed Recurring:  ${buckets["lapsed-recurring"].length}`);
  console.log(`  Dormant:           ${buckets["dormant"].length}`);
  console.log(`  Active (skipped):  ${skipped}`);
  console.log(`  Total to enroll:   ${total}`);

  // Clear existing enrollments and reset counters
  console.log("\nClearing previous enrollments...");
  await db.execute("DELETE FROM always_on_enrollments WHERE 1=1");
  await db.execute("UPDATE always_on_groups SET totalEnrolled = 0");

  const BATCH = 1000;
  let totalInserted = 0;

  for (const [groupType, jobList] of Object.entries(buckets)) {
    const groupId = groupMap[groupType];
    if (!groupId || jobList.length === 0) continue;

    console.log(`\nInserting ${jobList.length} rows for group: ${groupType}`);
    let inserted = 0;

    for (let i = 0; i < jobList.length; i += BATCH) {
      const chunk = jobList.slice(i, i + BATCH);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, NOW())").join(", ");
      const values = chunk.flatMap((j) => [
        groupId,
        j.id,
        j.phone,
        j.firstName ?? (j.name ? j.name.split(" ")[0] : null),
        j.name ?? null,
        j.frequency ?? null,
        j.lastBookingPrice ?? null,
      ]);

      const [result] = await db.execute(
        `INSERT IGNORE INTO always_on_enrollments
           (groupId, completedJobId, phone, firstName, name, frequency, lastBookingPrice, enrolledAt)
         VALUES ${placeholders}`,
        values
      );
      inserted += result.affectedRows;
    }

    // Update totalEnrolled counter
    await db.execute(
      "UPDATE always_on_groups SET totalEnrolled = ? WHERE id = ?",
      [inserted, groupId]
    );

    console.log(`  ✓ Inserted ${inserted}`);
    totalInserted += inserted;
  }

  console.log(`\n✅ Bulk enrollment complete: ${totalInserted} unique customers enrolled`);
  await db.end();
}

main().catch((err) => {
  console.error("Bulk enrollment failed:", err);
  process.exit(1);
});
