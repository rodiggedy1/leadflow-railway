import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Cancel all active enrollments where nextSendAt is more than 2 hours in the past
const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
const cutoffISO = new Date(cutoffMs).toISOString().slice(0, 19).replace('T', ' ');

console.log('Cutoff time (UTC):', cutoffISO);

const [preview] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM nurture_enrollments WHERE status = 'active' AND nextSendAt < '${cutoffISO}'`
);
console.log('Enrollments to cancel:', preview[0].cnt);

const [result] = await conn.execute(
  `UPDATE nurture_enrollments SET status = 'cancelled' WHERE status = 'active' AND nextSendAt < '${cutoffISO}'`
);
console.log('Cancelled:', result.affectedRows);

const [remaining] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM nurture_enrollments WHERE status = 'active'`
);
console.log('Remaining active enrollments:', remaining[0].cnt);

await conn.end();
