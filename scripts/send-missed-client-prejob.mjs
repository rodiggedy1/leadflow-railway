/**
 * One-shot script: sends the missed client pre-job SMS to the 3 eight-thirty AM
 * jobs that were skipped due to the timing window bug (fixed in 01e053be).
 *
 * Job IDs: 90006 (Justin Dean), 90007 (Leah Martin), 90008 (Anna Maria)
 *
 * Usage: node scripts/send-missed-client-prejob.mjs
 */

import "dotenv/config";
import { createConnection } from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID;
if (!OPENPHONE_API_KEY || !OPENPHONE_PHONE_NUMBER_ID) {
  console.error("OPENPHONE_API_KEY or OPENPHONE_PHONE_NUMBER_ID not set");
  process.exit(1);
}

const JOB_IDS = [90006, 90007, 90008];

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function firstName(fullName) {
  return (fullName || "").split(/[\s,]+/)[0] || fullName;
}

async function sendSms(to, content) {
  const normalized = normalizePhone(to);
  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: OPENPHONE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      from: OPENPHONE_PHONE_NUMBER_ID,
      to: [normalized],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: body?.message || `HTTP ${res.status}` };
  }
  return { success: true, messageId: body?.data?.id };
}

async function run() {
  // Parse MySQL connection string: mysql://user:pass@host:port/db
  const url = new URL(DB_URL);
  const conn = await createConnection({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });

  for (const jobId of JOB_IDS) {
    // Check if already sent
    const [existing] = await conn.execute(
      "SELECT id FROM field_mgmt_log WHERE cleanerJobId = ? AND step = 'client_pre_job' LIMIT 1",
      [jobId]
    );
    if (existing.length > 0) {
      console.log(`[Job ${jobId}] client_pre_job already fired — skipping`);
      continue;
    }

    // Fetch job details
    const [rows] = await conn.execute(
      "SELECT id, customerName, customerPhone, jobAddress, serviceDateTime, trackerToken FROM cleaner_jobs WHERE id = ? LIMIT 1",
      [jobId]
    );
    const job = rows[0];
    if (!job) {
      console.warn(`[Job ${jobId}] Not found — skipping`);
      continue;
    }

    const clientPhone = job.customerPhone;
    if (!clientPhone) {
      console.warn(`[Job ${jobId}] No customer phone — skipping`);
      continue;
    }

    // Build tracking link
    const trackingLink = job.trackerToken
      ? `https://quote.maidinblack.com/track/${job.trackerToken}`
      : "https://quote.maidinblack.com";

    // Parse service time for display
    const serviceTime = new Date(job.serviceDateTime);
    const timeStr = serviceTime.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const clientFirstName = firstName(job.customerName);
    const msg = [
      `Hey ${clientFirstName} — you're all set for your home cleaning today at ${timeStr} 😊`,
      ``,
      `You can follow your cleaning here: ${trackingLink}`,
      ``,
      `We'll update this in real time if anything changes, including arrival timing.`,
    ].join("\n");

    console.log(`[Job ${jobId}] Sending to ${clientPhone} (${clientFirstName})...`);
    const result = await sendSms(clientPhone, msg);

    if (result.success) {
      // Record in field_mgmt_log
      await conn.execute(
        `INSERT INTO field_mgmt_log (cleanerJobId, step, success, smsSent, recipientPhone, firedAt)
         VALUES (?, 'client_pre_job', 1, ?, ?, NOW())`,
        [jobId, msg, normalizePhone(clientPhone)]
      );
      console.log(`[Job ${jobId}] ✅ Sent (messageId: ${result.messageId})`);
    } else {
      await conn.execute(
        `INSERT INTO field_mgmt_log (cleanerJobId, step, success, smsSent, recipientPhone, errorDetail, firedAt)
         VALUES (?, 'client_pre_job', 0, ?, ?, ?, NOW())`,
        [jobId, msg, normalizePhone(clientPhone), result.error]
      );
      console.error(`[Job ${jobId}] ❌ Failed: ${result.error}`);
    }

    // Rate-limit: 1 second between sends
    await new Promise((r) => setTimeout(r, 1000));
  }

  await conn.end();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
