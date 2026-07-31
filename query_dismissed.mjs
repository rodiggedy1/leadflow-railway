import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  'SELECT id, status, dismissedBy, dismissedAt, updatedAt FROM madison_sms_drafts WHERE id IN (1380313, 1380315, 1380316)'
);
console.log(JSON.stringify(rows, null, 2));
await conn.end();
