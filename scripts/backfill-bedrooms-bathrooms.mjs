/**
 * Backfill bedrooms + bathrooms for completed_jobs rows.
 * Fetches bookings from Launch27 by date (one API call per day),
 * then updates matching rows by launch27BookingId.
 *
 * Usage: node scripts/backfill-bedrooms-bathrooms.mjs
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const BEARER = process.env.LAUNCH27_BEARER_TOKEN;
const TENANT = process.env.LAUNCH27_TENANT || 'maidsinblack';
const BASE_URL = `https://${TENANT}.launch27.com`;

async function fetchBookingsForDate(date) {
  const url = `${BASE_URL}/v1/staff/bookings?from=${date}&to=${date}&options=completed,exclude_forecasted&limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.warn(`  API error ${res.status} for ${date}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function parseBedroomsBathrooms(booking) {
  let bedrooms = null;
  let bathrooms = null;
  for (const svc of booking.services ?? []) {
    const m = svc.name?.match(/(\d+)\s*bedroom/i);
    if (m && bedrooms === null) bedrooms = parseInt(m[1], 10);
    for (const pp of svc.pricing_parameters ?? []) {
      if (pp.name?.toLowerCase().includes('bathroom')) {
        bathrooms = (bathrooms ?? 0) + (pp.quantity ?? 0);
      }
    }
  }
  return { bedrooms, bathrooms };
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get distinct dates that have rows needing backfill (bedrooms IS NULL)
const [dates] = await conn.execute(
  "SELECT DISTINCT jobDate FROM completed_jobs WHERE bedrooms IS NULL AND launch27BookingId IS NOT NULL ORDER BY jobDate DESC"
);
console.log(`Found ${dates.length} distinct dates to backfill`);

let totalUpdated = 0;
let datesDone = 0;

for (const { jobDate } of dates) {
  const bookings = await fetchBookingsForDate(jobDate);
  let dayUpdated = 0;
  for (const b of bookings) {
    const { bedrooms, bathrooms } = parseBedroomsBathrooms(b);
    if (bedrooms !== null || bathrooms !== null) {
      const [result] = await conn.execute(
        "UPDATE completed_jobs SET bedrooms = ?, bathrooms = ? WHERE launch27BookingId = ? AND bedrooms IS NULL",
        [bedrooms, bathrooms, String(b.id)]
      );
      if (result.affectedRows > 0) dayUpdated++;
    }
  }
  totalUpdated += dayUpdated;
  datesDone++;
  if (datesDone % 10 === 0) {
    console.log(`  Progress: ${datesDone}/${dates.length} dates, ${totalUpdated} rows updated`);
  }
  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 200));
}

console.log(`\nBackfill complete: ${totalUpdated} rows updated across ${datesDone} dates`);
await conn.end();
