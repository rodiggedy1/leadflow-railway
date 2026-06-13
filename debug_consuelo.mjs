import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [jobs] = await conn.execute(`
  SELECT id, customerName, jobAddress, serviceDateTime, jobDate, bookingStatus
  FROM cleaner_jobs
  WHERE jobDate = '2026-06-11' AND teamName = 'Consuelo Alba'
  ORDER BY serviceDateTime ASC
`);

console.log('Consuelo Alba jobs for 2026-06-11:');
for (const j of jobs) {
  const local = j.serviceDateTime ? new Date(j.serviceDateTime).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'null';
  console.log(`  job${j.id} "${j.customerName}" serviceDateTime=${j.serviceDateTime} (ET: ${local}) status=${j.bookingStatus}`);
}

await conn.end();
