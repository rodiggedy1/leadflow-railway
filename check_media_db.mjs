import { createConnection } from 'mysql2/promise';

// Read DATABASE_URL from the process env (injected by webdev platform)
const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await createConnection(url);

const [rows] = await conn.execute(
  'SELECT id, leadName, leadPhone, messageHistory, updatedAt FROM conversationSessions ORDER BY updatedAt DESC LIMIT 5'
);

for (const row of rows) {
  let history = [];
  try { history = JSON.parse(row.messageHistory ?? '[]'); } catch {}
  const last = history[history.length - 1];
  console.log(`\nSession ${row.id} | ${row.leadName} | ${row.leadPhone}`);
  console.log('Last msg:', JSON.stringify(last));
}

await conn.end();
