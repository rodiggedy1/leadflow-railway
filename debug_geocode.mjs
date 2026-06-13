import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get Consuelo Alba's jobs for June 11
const [jobs] = await conn.execute(`
  SELECT id, customerName, jobAddress, serviceDateTime
  FROM cleaner_jobs
  WHERE jobDate = '2026-06-11' AND teamName = 'Consuelo Alba'
  ORDER BY serviceDateTime ASC
`);
console.log('Jobs:', JSON.stringify(jobs, null, 2));

// Check geocode cache for each address
for (const j of jobs) {
  const key = j.jobAddress.trim().toLowerCase();
  const [cached] = await conn.execute(
    'SELECT lat, lng, formattedAddress FROM job_geo_cache WHERE addressKey = ?',
    [key]
  );
  console.log(`Geocode for "${j.jobAddress}":`, cached[0] ?? 'NOT CACHED');
}

await conn.end();
