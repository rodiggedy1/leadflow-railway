import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  `SELECT id, event_type, from_phone, to_phone, raw_payload, created_at
   FROM webhook_events
   WHERE from_phone LIKE '%3029816191%'
     AND event_type = 'message.received'
   ORDER BY id DESC
   LIMIT 3`
);

console.log('=== Recent inbound SMS webhook payloads for 302-981-6191 ===');
for (const row of rows) {
  console.log('\n--- id:', row.id, 'created_at:', row.created_at);
  console.log('from_phone:', row.from_phone, '| to_phone:', row.to_phone);
  // Print the full raw_payload
  const payload = typeof row.raw_payload === 'string' ? row.raw_payload : JSON.stringify(row.raw_payload);
  console.log('raw_payload:', payload);
}

await conn.end();
