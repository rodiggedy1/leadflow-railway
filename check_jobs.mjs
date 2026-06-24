import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// First show all columns available on cleaner_jobs
const [cols] = await conn.execute(`DESCRIBE cleaner_jobs`);
console.log("COLUMNS:", cols.map(c => c.Field).join(', '));

// Then check the actual data for the flagged jobs
const [rows] = await conn.execute(`
  SELECT id, customerName, jobDate, bookingStatus, cleanerProfileId, teamId, teamName
  FROM cleaner_jobs
  WHERE jobDate = '2026-06-24'
    AND bookingStatus NOT IN ('cancelled', 'rescheduled')
    AND customerName IN ('Nicole Lincoln', 'Stephen Ganote', 'Matt Gray', 'Erica Andersen')
  LIMIT 5
`);
console.log("JOBS:", JSON.stringify(rows, null, 2));
await conn.end();
