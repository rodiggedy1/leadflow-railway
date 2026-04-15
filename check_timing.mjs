import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
const conn = await createConnection(process.env.DATABASE_URL);

// Check both Aubrey sessions with full timestamps
const [rows] = await conn.execute(
  "SELECT id, leadSource, stage, createdAt, updatedAt, messageHistory FROM conversation_sessions WHERE id IN (1470076, 1470095) ORDER BY id"
);
for (const s of rows) {
  let msgs = [];
  try { msgs = JSON.parse(s.messageHistory || '[]'); } catch {}
  console.log(`\nSession ${s.id}: ${s.leadSource}, stage=${s.stage}`);
  console.log(`  created=${s.createdAt}, updated=${s.updatedAt}`);
  msgs.forEach(m => console.log(`  [${m.role}] ts=${m.ts} ${new Date(m.ts||0).toISOString()} ${String(m.content).slice(0,100)}`));
}

await conn.end();
