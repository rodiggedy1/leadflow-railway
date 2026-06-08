import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT name, phone, frequency, jobDate as last_job, lastBookingPrice as price
  FROM completed_jobs
  WHERE reactivationEligible = 1
  ORDER BY jobDate DESC
`);

console.log(`Total: ${rows.length} eligible contacts\n`);
console.log('Name | Last Job | Frequency | Price');
console.log('-----|----------|-----------|------');
for (const r of rows) {
  const price = r.price ? `$${r.price}` : '—';
  console.log(`${r.name} | ${r.last_job} | ${r.frequency || 'One time'} | ${price}`);
}

await conn.end();
