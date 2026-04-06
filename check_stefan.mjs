import { readFileSync } from 'fs';
try {
  const env = readFileSync('/home/ubuntu/leadflow-quote-form/.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// Check if Stefan's booking 444675 is in cleanerJobs
const [rows] = await conn.execute(
  'SELECT id, bookingId, bookingStatus, clientName, jobDate, serviceDateTime, teamName FROM cleaner_jobs WHERE bookingId = ?',
  [444675]
);
console.log('Stefan booking 444675 in DB:', rows.length > 0 ? JSON.stringify(rows, null, 2) : 'NOT FOUND');

// Also check all Apr 6 jobs to see what's there
const [allRows] = await conn.execute(
  'SELECT id, bookingId, bookingStatus, clientName, serviceDateTime, teamName FROM cleaner_jobs WHERE jobDate = ? ORDER BY serviceDateTime',
  ['2026-04-06']
);
console.log('\nAll Apr 6 jobs in DB:', allRows.length);
for (const r of allRows) {
  console.log(`  ID:${r.bookingId} | ${r.clientName} | ${r.serviceDateTime} | status:${r.bookingStatus} | ${r.teamName}`);
}

await conn.end();
