import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [jobs] = await conn.execute(
  'SELECT id, customerName, jobAddress, serviceDateTime, jobDate, bookingStatus, teamName FROM cleaner_jobs WHERE id IN (1620387, 1620397)'
);
console.log('JOBS:', JSON.stringify(jobs, null, 2));

const [asgns] = await conn.execute(
  'SELECT cleanerJobId, teamId, routeOrder, driveTimeSecs, isManual FROM schedule_assignments WHERE cleanerJobId IN (1620387, 1620397) AND jobDate = "2026-06-11"'
);
console.log('ASSIGNMENTS:', JSON.stringify(asgns, null, 2));

await conn.end();
