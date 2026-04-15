import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute("SELECT id, leadSource, stage, messageHistory FROM conversation_sessions WHERE id = ?", [1470076]);
const s = rows[0];
let msgs = [];
try { msgs = JSON.parse(s.messageHistory || '[]'); } catch {}
console.log(`Session ${s.id}: ${s.leadSource}, stage=${s.stage}`);
msgs.forEach(m => console.log(`  [${m.role}] ts=${m.ts} ${String(m.content).slice(0,150)}`));
await conn.end();
