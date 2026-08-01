import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// Get a real inbound SMS webhook payload for Melea (781-771-4596)
const [rows] = await conn.execute(
  `SELECT id, event_type, from_phone, to_phone, raw_payload, created_at
   FROM webhook_events
   WHERE from_phone LIKE '%7817714596%'
     AND event_type = 'message.received'
   ORDER BY id DESC
   LIMIT 3`
);
console.log('=== Recent inbound SMS webhook payloads for Melea ===');
for (const row of rows) {
  console.log('\n--- id:', row.id, 'created_at:', row.created_at);
  console.log('event_type:', row.event_type);
  console.log('from_phone:', row.from_phone);
  console.log('raw_payload:', row.raw_payload);
}

await conn.end();
