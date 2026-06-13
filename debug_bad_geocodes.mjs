import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Find geocodes where address says DC but coordinates are in MD (lng > -77.12 and lat < 38.99 but east of DC boundary)
// DC is roughly: lat 38.79-38.99, lng -77.12 to -76.91
// But PG County MD overlaps the east side. DC addresses with lng > -77.00 and lat < 38.93 are suspicious.
// More specifically: DC zip codes should NOT geocode to lng > -76.95 (that's deep in MD)
const [badGeos] = await conn.execute(`
  SELECT addressKey, originalAddress, lat, lng, formattedAddress
  FROM job_geo_cache
  WHERE (originalAddress LIKE '%, DC %' OR originalAddress LIKE '%, Washington, DC%')
    AND lng > -76.97
  ORDER BY lng DESC
  LIMIT 50
`);

console.log('Potentially bad DC geocodes (lng > -76.97):');
for (const g of badGeos) {
  console.log(`  "${g.originalAddress}" -> (${g.lat}, ${g.lng}) formatted: "${g.formattedAddress}"`);
}

console.log('\nTotal:', badGeos.length);
await conn.end();
