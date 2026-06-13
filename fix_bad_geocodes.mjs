/**
 * Finds geocache entries where the address says DC but coordinates are clearly not in DC,
 * or address says VA but coordinates are not in VA, etc.
 * 
 * State bounding boxes (approximate):
 * DC:  lat 38.791-38.996, lng -77.120 to -76.909
 * MD:  lat 37.886-39.723, lng -79.487 to -74.986
 * VA:  lat 36.540-39.466, lng -83.675 to -75.242
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const STATE_BOUNDS = {
  DC: { minLat: 38.791, maxLat: 38.996, minLng: -77.120, maxLng: -76.909 },
  VA: { minLat: 36.540, maxLat: 39.466, minLng: -83.675, maxLng: -75.242 },
  MD: { minLat: 37.886, maxLat: 39.723, minLng: -79.487, maxLng: -74.986 },
};

function isInBounds(lat, lng, state) {
  const b = STATE_BOUNDS[state];
  if (!b) return true; // unknown state, don't delete
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute('SELECT id, addressKey, originalAddress, lat, lng, formattedAddress FROM job_geo_cache');

const toDelete = [];
for (const row of rows) {
  const m = row.originalAddress?.match(/,\s*([A-Z]{2})\s*\d{0,5}\s*$/i);
  if (!m) continue;
  const state = m[1].toUpperCase();
  if (!STATE_BOUNDS[state]) continue;
  if (!isInBounds(row.lat, row.lng, state)) {
    toDelete.push(row);
    console.log(`BAD: "${row.originalAddress}" -> (${row.lat}, ${row.lng}) [expected in ${state}] formatted: "${row.formattedAddress}"`);
  }
}

console.log(`\nFound ${toDelete.length} bad geocodes.`);

if (toDelete.length > 0) {
  const ids = toDelete.map(r => r.id);
  await conn.execute(`DELETE FROM job_geo_cache WHERE id IN (${ids.join(',')})`);
  console.log(`Deleted ${toDelete.length} bad geocode entries. They will be re-geocoded correctly on next use.`);
}

await conn.end();
