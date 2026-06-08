import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ALL campaign:tomorrow_slots sessions created today (any time)
const [rows] = await conn.execute(
  "SELECT id, leadPhone, leadName, createdAt FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND DATE(createdAt) = '2026-05-18' ORDER BY createdAt ASC"
);

console.log('ALL campaign sessions today (' + rows.length + '):');
rows.forEach((r, i) => console.log((i+1) + ':', r.createdAt, '|', r.leadName, '|', r.leadPhone));

const allSentPhones = new Set(rows.map(r => r.leadPhone));
console.log('\nUnique phones sent today:', allSentPhones.size);
console.log([...allSentPhones].join('\n'));

await conn.end();
