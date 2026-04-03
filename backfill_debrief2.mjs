import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const db = await mysql.createConnection(process.env.DATABASE_URL);

// The existing debrief for Victor Purcell (session 1380004)
// Update it to include the grade field
const rows = await db.execute(
  `SELECT id, call_debrief FROM openphone_call_recordings WHERE session_id = 1380004 AND call_debrief IS NOT NULL LIMIT 1`
);

const row = rows[0]?.[0];
if (!row) {
  console.log('No debrief found for session 1380004');
  process.exit(1);
}

console.log('Current debrief:', row.call_debrief);
const parsed = JSON.parse(row.call_debrief);

// Add grade if missing
if (!parsed.grade) {
  parsed.grade = 'C'; // The call was average — got the info but missed the close
  await db.execute(
    `UPDATE openphone_call_recordings SET call_debrief = ? WHERE id = ?`,
    [JSON.stringify(parsed), row.id]
  );
  console.log('Updated debrief with grade C for Victor Purcell (session 1380004)');
} else {
  console.log('Grade already present:', parsed.grade);
}

await db.end();
