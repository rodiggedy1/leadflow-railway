import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT cj.id, cj.customerName, cj.jobDate, sa.teamId, sa.teamName, sa.isManual
  FROM cleaner_jobs cj
  LEFT JOIN schedule_assignments sa ON sa.cleanerJobId = cj.id AND sa.jobDate = '2026-06-24'
  WHERE cj.jobDate = '2026-06-24'
    AND cj.bookingStatus NOT IN ('cancelled', 'rescheduled')
    AND cj.customerName IN ('Nicole Lincoln', 'Stephen Ganote', 'Mitchell Mail', 'Rick Woler', 'Jay Shrestha', 'Matt Gray', 'Erica Andersen', 'Sheila Strong')
  ORDER BY cj.customerName
`);

console.log(JSON.stringify(rows, null, 2));
await conn.end();
