import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

const jobId = 990013; // Heather McHugh 2026-05-21 10:30 AM job

// Get field_mgmt_log for this job
const [logs] = await conn.execute(
  `SELECT step, success, smsSent, recipientPhone, errorDetail, firedAt
   FROM field_mgmt_log
   WHERE cleanerJobId = ?
   ORDER BY firedAt ASC`,
  [jobId]
);
console.log('=== FIELD MGMT LOG ===');
console.log(JSON.stringify(logs, null, 2));

// Get job status history
const [history] = await conn.execute(
  `SELECT status, source, changedAt
   FROM job_status_history
   WHERE cleanerJobId = ?
   ORDER BY changedAt ASC`,
  [jobId]
);
console.log('\n=== STATUS HISTORY ===');
console.log(JSON.stringify(history, null, 2));

await conn.end();
