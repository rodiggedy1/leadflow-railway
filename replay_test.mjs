import { createConnection } from 'mysql2/promise';

const PREVIEW_URL = 'https://leadflow-railway-preview.up.railway.app/api/webhooks/openphone';

// Base payload from real captured event for 302-981-6191
// Same conversationId, phoneNumberId, from/to — so it routes to the same session
// We change id (event ID) and data.object.id (message ID) for each replay to bypass idempotency
const basePayload = {
  "object": "event",
  "apiVersion": "v4",
  "type": "message.received",
  "data": {
    "object": {
      "object": "message",
      "from": "+13029816191",
      "to": "+12028885362",
      "direction": "incoming",
      "media": [],
      "status": "received",
      "userId": "USWTjeqCBB",
      "phoneNumberId": "PN0wVLcpCq",
      "contactIds": ["627ab80478e8a6f338a07cd6"]
    },
    "deepLink": "https://my.quo.com/inbox/PN0wVLcpCq/c/CN7cd029d8916041eb90ba2e27073c656f?at=PLACEHOLDER"
  }
};

function makePayload(n) {
  const ts = new Date().toISOString();
  const evId = `EV_REPLAY_TEST_${n}_${Date.now()}`;
  const msgId = `AC_REPLAY_TEST_${n}_${Date.now()}`;
  return {
    ...basePayload,
    id: evId,
    createdAt: ts,
    data: {
      ...basePayload.data,
      deepLink: `https://my.quo.com/inbox/PN0wVLcpCq/c/CN7cd029d8916041eb90ba2e27073c656f?at=${msgId}`,
      object: {
        ...basePayload.data.object,
        id: msgId,
        text: `Replay test ${n} at ${ts}`,
        body: `Replay test ${n} at ${ts}`,
        createdAt: ts,
      }
    }
  };
}

async function queryCards(conn, label) {
  const [rows] = await conn.execute(
    `SELECT m.id, m.sessionId, m.activeDedupKey, m.cardStatus, m.createdAt,
            JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.draftId')) AS draftId,
            JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.sessionId')) AS metaSessionId
     FROM ops_chat_messages m
     WHERE m.quickAction = 'madison_sms_draft'
       AND JSON_EXTRACT(m.metadata, '$.sessionId') IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.sessionId')) IN (
         SELECT CAST(id AS CHAR) FROM conversation_sessions
         WHERE leadPhone LIKE '%3029816191%'
       )
     ORDER BY m.id DESC
     LIMIT 5`
  );
  console.log(`\n=== ${label} ===`);
  if (rows.length === 0) {
    console.log('  (no cards found)');
  }
  for (const r of rows) {
    console.log(`  id=${r.id} sessionId=${r.sessionId} activeDedupKey=${r.activeDedupKey} cardStatus=${r.cardStatus} draftId=${r.draftId} metaSessionId=${r.metaSessionId} createdAt=${r.createdAt}`);
  }
  return rows;
}

async function querySmsCardDiag(conn, label) {
  try {
    const [rows] = await conn.execute(
      `SELECT * FROM sms_card_diag ORDER BY id DESC LIMIT 5`
    );
    console.log(`\n=== sms_card_diag ${label} ===`);
    if (rows.length === 0) {
      console.log('  (empty)');
    }
    for (const r of rows) {
      console.log(`  id=${r.id} sessionId=${r.sessionId} draftId=${r.draftId} insertId=${r.insertId} affectedRows=${r.affectedRows} dedupKey=${r.dedupKey} createdAt=${r.createdAt}`);
      if (r.diagPayload) {
        try {
          const p = JSON.parse(r.diagPayload);
          console.log('  diagPayload:', JSON.stringify(p, null, 2));
        } catch { console.log('  diagPayload (raw):', r.diagPayload); }
      }
    }
    return rows;
  } catch (e) {
    console.log(`\n=== sms_card_diag ${label} — table missing or error: ${e.message} ===`);
    return [];
  }
}

async function sendReplay(n) {
  const payload = makePayload(n);
  console.log(`\n>>> Sending replay ${n} to preview...`);
  console.log('  event_id:', payload.id);
  console.log('  message_id:', payload.data.object.id);
  console.log('  text:', payload.data.object.text);
  const res = await fetch(PREVIEW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  console.log(`  HTTP status: ${res.status}`);
  const body = await res.text();
  console.log(`  Response: ${body}`);
  return payload;
}

const conn = await createConnection(process.env.DATABASE_URL);

// Baseline
await queryCards(conn, 'BEFORE REPLAY');
await querySmsCardDiag(conn, 'BEFORE REPLAY');

// Replay 1
const p1 = await sendReplay(1);
// Wait for async processing
console.log('\n  Waiting 8s for async processing...');
await new Promise(r => setTimeout(r, 8000));
const after1 = await queryCards(conn, 'AFTER REPLAY 1');
await querySmsCardDiag(conn, 'AFTER REPLAY 1');

// Replay 2
const p2 = await sendReplay(2);
console.log('\n  Waiting 8s for async processing...');
await new Promise(r => setTimeout(r, 8000));
const after2 = await queryCards(conn, 'AFTER REPLAY 2');
await querySmsCardDiag(conn, 'AFTER REPLAY 2');

// Summary
console.log('\n=== SUMMARY ===');
const ids1 = after1.map(r => r.id);
const ids2 = after2.map(r => r.id);
const newAfter2 = ids2.filter(id => !ids1.includes(id));
if (newAfter2.length === 0) {
  console.log('✅ PASS: No new card created after replay 2 — upsert fired correctly');
} else {
  console.log('❌ FAIL: New card(s) created after replay 2:', newAfter2);
}

await conn.end();
