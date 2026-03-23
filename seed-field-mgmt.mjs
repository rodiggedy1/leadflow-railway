/**
 * seed-field-mgmt.mjs
 * One-time seed script: inserts realistic cleaner_jobs + field_mgmt_log rows
 * for today's date so the Field Management Log tab can be visually tested.
 *
 * Usage: node seed-field-mgmt.mjs
 * Safe to re-run: uses a sentinel completedJobId range (999001–999010) so rows
 * can be identified and removed later without touching real data.
 *
 * To clean up: node seed-field-mgmt.mjs --cleanup
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { randomBytes } from "crypto";

dotenv.config();

const SENTINEL_BASE = 999001; // completedJobId range used to identify seed rows

// Today's date in ET (America/New_York) as YYYY-MM-DD
const todayET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
}).format(new Date());

// Build a datetime string for today at a given hour:minute (ET → UTC offset approx)
function todayAt(hour, minute = 0) {
  // Construct as if in ET (UTC-4 in EDT, UTC-5 in EST)
  // We'll store as ISO string; the DB stores as UTC timestamp
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Random tracker token
function token() {
  return randomBytes(8).toString("hex");
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const JOBS = [
  {
    completedJobId: SENTINEL_BASE + 0,
    bookingId: 88001,
    cleanerProfileId: 1,
    cleanerName: "Maria Santos",
    teamName: "Team Maria",
    teamId: 11,
    jobDate: todayET,
    serviceDateTime: todayAt(9, 0).toISOString(),
    customerName: "Jennifer Walsh",
    customerPhone: "+12025550101",
    jobAddress: "1420 K St NW, Washington DC 20005",
    serviceType: "Standard Cleaning, 2 bedrooms, 2 bathrooms",
    bookingStatus: "completed",
    jobStatus: "completed",
    trackerToken: token(),
    delayMinutes: null,
    issueNote: null,
  },
  {
    completedJobId: SENTINEL_BASE + 1,
    bookingId: 88002,
    cleanerProfileId: 2,
    cleanerName: "Claudia Reyes",
    teamName: "Team Claudia",
    teamId: 12,
    jobDate: todayET,
    serviceDateTime: todayAt(10, 0).toISOString(),
    customerName: "Michael Torres",
    customerPhone: "+12025550202",
    jobAddress: "3200 Wisconsin Ave NW, Washington DC 20016",
    serviceType: "Deep Clean, 3 bedrooms, 2 bathrooms",
    bookingStatus: "assigned",
    jobStatus: "in_progress",
    trackerToken: token(),
    delayMinutes: null,
    issueNote: null,
  },
  {
    completedJobId: SENTINEL_BASE + 2,
    bookingId: 88003,
    cleanerProfileId: 3,
    cleanerName: "Fatima Diallo",
    teamName: "Team Fatima",
    teamId: 13,
    jobDate: todayET,
    serviceDateTime: todayAt(11, 30).toISOString(),
    customerName: "Sarah Kim",
    customerPhone: "+12025550303",
    jobAddress: "2501 Q St NW, Washington DC 20007",
    serviceType: "Move In/Out Clean, 1 bedroom, 1 bathroom",
    bookingStatus: "assigned",
    jobStatus: "running_late",
    trackerToken: token(),
    delayMinutes: 25,
    issueNote: null,
  },
  {
    completedJobId: SENTINEL_BASE + 3,
    bookingId: 88004,
    cleanerProfileId: 4,
    cleanerName: "Ana Gutierrez",
    teamName: "Team Ana",
    teamId: 14,
    jobDate: todayET,
    serviceDateTime: todayAt(13, 0).toISOString(),
    customerName: "David Chen",
    customerPhone: "+12025550404",
    jobAddress: "1600 16th St NW, Washington DC 20009",
    serviceType: "Standard Cleaning, 2 bedrooms, 1 bathroom",
    bookingStatus: "assigned",
    jobStatus: "on_the_way",
    trackerToken: token(),
    delayMinutes: null,
    issueNote: null,
  },
  {
    completedJobId: SENTINEL_BASE + 4,
    bookingId: 88005,
    cleanerProfileId: 5,
    cleanerName: "Priya Nair",
    teamName: "Team Priya",
    teamId: 15,
    jobDate: todayET,
    serviceDateTime: todayAt(14, 0).toISOString(),
    customerName: "Rachel Green",
    customerPhone: "+12025550505",
    jobAddress: "4500 Connecticut Ave NW, Washington DC 20008",
    serviceType: "Deep Clean, 4 bedrooms, 3 bathrooms",
    bookingStatus: "assigned",
    jobStatus: null, // not started yet
    trackerToken: token(),
    delayMinutes: null,
    issueNote: null,
  },
  {
    completedJobId: SENTINEL_BASE + 5,
    bookingId: 88006,
    cleanerProfileId: 6,
    cleanerName: "Lucia Morales",
    teamName: "Team Lucia",
    teamId: 16,
    jobDate: todayET,
    serviceDateTime: todayAt(15, 0).toISOString(),
    customerName: "James Park",
    customerPhone: "+12025550606",
    jobAddress: "700 New Hampshire Ave NW, Washington DC 20037",
    serviceType: "Standard Cleaning, 1 bedroom, 1 bathroom",
    bookingStatus: "assigned",
    jobStatus: "issue_at_property",
    trackerToken: token(),
    delayMinutes: null,
    issueNote: "Client locked the door and is not responding. Waiting outside.",
  },
];

// ── Log rows per job ──────────────────────────────────────────────────────────
// Each entry: [jobIndex, step, success, smsSent, recipientPhone, errorDetail, minutesAgo]

const LOG_ROWS = [
  // Job 0 — Maria, COMPLETED — full sequence fired successfully
  [0, "pre_job_reminder",    1, "Hey Maria — reminder for your cleaning at 9:00 AM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n• Be ready to check in + upload photos\n\nSet your status to \"On the Way\" in the app.", "+12025551001", null, 240],
  [0, "client_pre_job",      1, "Hey Jennifer — you're all set for your home cleaning today at 9:00 AM 😊\n\nYou can follow your cleaning here: https://quote.maidinblack.com/track/abc123\n\nWe'll update this in real time if anything changes.", "+12025550101", null, 239],
  [0, "client_on_the_way",   1, "Hi Jennifer! Your Maids in Black team is on the way and will arrive at 1420 K St NW around 9:05 AM. 🚗\n\nTrack their arrival in real time here: https://quote.maidinblack.com/track/abc123", "+12025550101", null, 200],
  [0, "arrived_checkin",     1, "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage — this protects you from being blamed.", "+12025551001", null, 195],
  [0, "mid_job_nudge",       1, "Quick check — everything going smoothly?\n\nRemember:\n• Kitchens + bathrooms = highest priority\n• Don't miss floors + surfaces\n\nReply if any issues.", "+12025551001", null, 140],
  [0, "completion_flow",     1, "Before leaving:\n\n1. Upload photos + double check notes + checklist\n2. Confirm:\n   • All rooms completed\n   • Trash removed\n   • Lights off / doors locked\n   • Walk the client around and ask for a review\n\nReply DONE when finished.", "+12025551001", null, 60],

  // Job 1 — Claudia, IN PROGRESS — partial sequence
  [1, "pre_job_reminder",    1, "Hey Claudia — reminder for your cleaning at 10:00 AM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n\nSet your status to \"On the Way\" in the app.", "+12025551002", null, 180],
  [1, "client_pre_job",      1, "Hey Michael — you're all set for your home cleaning today at 10:00 AM 😊\n\nYou can follow your cleaning here: https://quote.maidinblack.com/track/def456", "+12025550202", null, 179],
  [1, "client_on_the_way",   1, "Hi Michael! Your Maids in Black team is on the way and will arrive at 3200 Wisconsin Ave NW around 10:10 AM. 🚗", "+12025550202", null, 130],
  [1, "arrived_checkin",     1, "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage.", "+12025551002", null, 120],
  [1, "mid_job_nudge",       1, "Quick check — everything going smoothly?\n\nRemember:\n• Kitchens + bathrooms = highest priority\n\nReply if any issues.", "+12025551002", null, 65],

  // Job 2 — Fatima, RUNNING LATE — pre-job sent, running late notification sent
  [2, "pre_job_reminder",    1, "Hey Fatima — reminder for your cleaning at 11:30 AM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n\nSet your status to \"On the Way\" in the app.", "+12025551003", null, 150],
  [2, "client_pre_job",      1, "Hey Sarah — you're all set for your home cleaning today at 11:30 AM 😊\n\nYou can follow your cleaning here: https://quote.maidinblack.com/track/ghi789", "+12025550303", null, 149],
  [2, "client_running_late", 1, "Hey Sarah — quick heads up, the team is running about 25 minutes behind.\n\nYou can follow their updated arrival here: https://quote.maidinblack.com/track/ghi789\n\nReally appreciate your flexibility 🙏", "+12025550303", null, 40],

  // Job 3 — Ana, ON THE WAY — pre-job sent + on_the_way notification
  [3, "pre_job_reminder",    1, "Hey Ana — reminder for your cleaning at 1:00 PM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n\nSet your status to \"On the Way\" in the app.", "+12025551004", null, 90],
  [3, "client_pre_job",      1, "Hey David — you're all set for your home cleaning today at 1:00 PM 😊\n\nYou can follow your cleaning here: https://quote.maidinblack.com/track/jkl012", "+12025550404", null, 89],
  [3, "client_on_the_way",   1, "Hi David! Your Maids in Black team is on the way and will arrive at 1600 16th St NW around 1:10 PM. 🚗", "+12025550404", null, 20],

  // Job 4 — Priya, NOT STARTED — only pre-job reminder sent
  [4, "pre_job_reminder",    1, "Hey Priya — reminder for your cleaning at 2:00 PM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n\nSet your status to \"On the Way\" in the app.", "+12025551005", null, 60],
  [4, "client_pre_job",      0, null, "+12025550505", "OpenPhone API error: rate limit exceeded (429)", 59],

  // Job 5 — Lucia, ISSUE AT PROPERTY — exception escalation fired
  [5, "pre_job_reminder",    1, "Hey Lucia — reminder for your cleaning at 3:00 PM.\n\nBefore you arrive:\n• Review notes: https://app.maidsinblack.com\n• Bring full supplies\n\nSet your status to \"On the Way\" in the app.", "+12025551006", null, 120],
  [5, "client_pre_job",      1, "Hey James — you're all set for your home cleaning today at 3:00 PM 😊\n\nYou can follow your cleaning here: https://quote.maidinblack.com/track/mno345", "+12025550606", null, 119],
  [5, "client_on_the_way",   1, "Hi James! Your Maids in Black team is on the way and will arrive at 700 New Hampshire Ave NW around 3:05 PM. 🚗", "+12025550606", null, 70],
  [5, "arrived_checkin",     1, "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage.", "+12025551006", null, 60],
  [5, "exception_sms",       1, "Hey — we haven't received your check-in update. Is everything okay?", "+12025551006", null, 15],
  [5, "noshow_alert",        1, "🚨 ISSUE ALERT\n\nCleaner: Lucia Morales\nJob: James Park at 700 New Hampshire Ave NW\nScheduled: 3:00 PM\n\nCleaner reports being locked out. Please call the client immediately.", "+12025559999", null, 10],
];

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const cleanup = process.argv.includes("--cleanup");

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  if (cleanup) {
    console.log("🧹 Cleaning up seed data...");
    const [jobs] = await conn.execute(
      "SELECT id FROM cleaner_jobs WHERE completedJobId >= ? AND completedJobId <= ?",
      [SENTINEL_BASE, SENTINEL_BASE + 9]
    );
    const ids = jobs.map((r) => r.id);
    if (ids.length > 0) {
      await conn.execute(
        `DELETE FROM field_mgmt_log WHERE cleanerJobId IN (${ids.map(() => "?").join(",")})`,
        ids
      );
      await conn.execute(
        `DELETE FROM cleaner_jobs WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
      console.log(`✅ Removed ${ids.length} seed jobs and their log rows.`);
    } else {
      console.log("ℹ️  No seed data found to clean up.");
    }
    await conn.end();
    return;
  }

  // Check if seed data already exists
  const [existing] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM cleaner_jobs WHERE completedJobId >= ? AND completedJobId <= ?",
    [SENTINEL_BASE, SENTINEL_BASE + 9]
  );
  if (existing[0].cnt > 0) {
    console.log(`ℹ️  Seed data already exists (${existing[0].cnt} rows). Run with --cleanup first to re-seed.`);
    await conn.end();
    return;
  }

  console.log(`🌱 Seeding ${JOBS.length} cleaner jobs for ${todayET}...`);

  const insertedIds = [];

  for (const job of JOBS) {
    const [result] = await conn.execute(
      `INSERT INTO cleaner_jobs
        (completedJobId, bookingId, cleanerProfileId, cleanerName, teamName, teamId,
         jobDate, serviceDateTime, customerName, customerPhone, jobAddress, serviceType,
         bookingStatus, jobStatus, trackerToken, delayMinutes, issueNote,
         photoSubmitted, flagged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        job.completedJobId, job.bookingId, job.cleanerProfileId, job.cleanerName,
        job.teamName, job.teamId, job.jobDate, job.serviceDateTime,
        job.customerName, job.customerPhone, job.jobAddress, job.serviceType,
        job.bookingStatus, job.jobStatus ?? null, job.trackerToken,
        job.delayMinutes ?? null, job.issueNote ?? null,
      ]
    );
    insertedIds.push(result.insertId);
    console.log(`  ✓ Job ${result.insertId}: ${job.cleanerName} — ${job.customerName} (${job.jobStatus ?? "not started"})`);
  }

  console.log(`\n🌱 Seeding ${LOG_ROWS.length} field_mgmt_log rows...`);

  for (const [jobIdx, step, success, smsSent, recipientPhone, errorDetail, minutesAgo] of LOG_ROWS) {
    const jobId = insertedIds[jobIdx];
    const firedAt = new Date(Date.now() - minutesAgo * 60 * 1000);
    await conn.execute(
      `INSERT INTO field_mgmt_log
        (cleanerJobId, step, success, smsSent, recipientPhone, errorDetail, firedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [jobId, step, success, smsSent, recipientPhone, errorDetail, firedAt]
    );
    const icon = success ? "✓" : "✗";
    console.log(`  ${icon} Job ${jobId} (${JOBS[jobIdx].cleanerName}): ${step} — ${success ? "OK" : "FAILED"}`);
  }

  console.log(`
✅ Done! Seeded ${JOBS.length} jobs + ${LOG_ROWS.length} log rows for ${todayET}.

Open the Field Management → Job Log tab and select today's date (${todayET}).
You should see 6 job cards. Expand any card to see the timeline instantly —
no extra network requests (verify in DevTools → Network tab).

To clean up later: node seed-field-mgmt.mjs --cleanup
`);

  await conn.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
