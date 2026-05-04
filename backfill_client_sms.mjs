/**
 * Backfill today's outbound client SMS from fieldMgmtLog into jobSmsReplies.
 * NO SMS is sent. This is a read-from-fieldMgmtLog + insert-into-jobSmsReplies only.
 *
 * Client-facing steps: client_pre_job, client_on_the_way, client_running_late
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/leadflow-quote-form/.env' });

const STEP_LABELS = {
  client_pre_job: 'Pre-Job Reminder',
  client_on_the_way: 'Cleaner On the Way',
  client_running_late: 'Cleaner Running Late',
};

const CLIENT_STEPS = Object.keys(STEP_LABELS);

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get today's date in ET
const todayET = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const [m, d, y] = todayET.split('/');
const todayStr = `${y}-${m}-${d}`;
console.log('Backfilling for date (ET):', todayStr);

// Fetch all client-facing fieldMgmtLog rows for today's jobs where smsSent is not null
const placeholders = CLIENT_STEPS.map(() => '?').join(',');
const [rows] = await conn.execute(
  `SELECT fml.id, fml.cleanerJobId, fml.step, fml.smsSent, fml.recipientPhone, fml.firedAt, fml.openPhoneMessageId
   FROM field_mgmt_log fml
   JOIN cleaner_jobs cj ON cj.id = fml.cleanerJobId
   WHERE fml.step IN (${placeholders})
     AND fml.smsSent IS NOT NULL
     AND fml.success = 1
     AND cj.jobDate = ?
   ORDER BY fml.firedAt ASC`,
  [...CLIENT_STEPS, todayStr]
);

console.log(`Found ${rows.length} client SMS rows to backfill`);

let inserted = 0;
let skipped = 0;

for (const row of rows) {
  // Check if already in jobSmsReplies (avoid duplicates)
  // Match on cleanerJobId + body (smsSent text) + senderType=system_outbound
  const [existing] = await conn.execute(
    `SELECT id FROM job_sms_replies WHERE cleanerJobId = ? AND body = ? AND senderType = 'system_outbound' LIMIT 1`,
    [row.cleanerJobId, row.smsSent]
  );

  if (existing.length > 0) {
    console.log(`  SKIP job ${row.cleanerJobId} step ${row.step} — already exists`);
    skipped++;
    continue;
  }

  const stepLabel = STEP_LABELS[row.step] || row.step;
  const senderPhone = row.recipientPhone || '';

  await conn.execute(
    `INSERT INTO job_sms_replies (cleanerJobId, senderType, senderPhone, body, openPhoneMessageId, deliveryStatus, receivedAt)
     VALUES (?, 'system_outbound', ?, ?, ?, 'sent', ?)`,
    [
      row.cleanerJobId,
      senderPhone,
      row.smsSent,
      row.openPhoneMessageId || null,
      row.firedAt,
    ]
  );

  console.log(`  INSERTED job ${row.cleanerJobId} step ${row.step} (${stepLabel})`);
  inserted++;
}

console.log(`\nDone. Inserted: ${inserted}, Skipped (already existed): ${skipped}`);
await conn.end();
