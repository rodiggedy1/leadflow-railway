/**
 * Sends the campaign SMS to contacts from the top-50 batch that did NOT
 * receive a message during today's interrupted blast.
 * Throttle: 1 per 12 seconds (5/min).
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID;
const SCRIPT = "Hi {{name}}, it's Maids in Black! 🏠 We have a last-minute opening tomorrow — perfect timing to get your home sparkling! Want to grab the slot? Reply YES and we'll confirm right away! ✨";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Who was already sent during today's blast (sessions created 23:36+ UTC)
const [rawSent] = await conn.execute(
  "SELECT leadPhone FROM conversation_sessions WHERE leadSource = 'campaign:tomorrow_slots' AND createdAt >= '2026-05-18 23:36:00'"
);
const sentPhones = new Set(rawSent.map(r => r.leadPhone));
console.log('Already sent to:', sentPhones.size, 'phones');

// Full eligible top-50 (deduped by phone)
const [eligible] = await conn.execute(`
  SELECT cj.name, cj.firstName, cj.phone, cj.jobDate, cj.lastBookingPrice, cj.serviceType, cj.frequency
  FROM completed_jobs cj
  INNER JOIN (
    SELECT phone, MAX(jobDate) AS maxJobDate
    FROM completed_jobs
    WHERE reactivationEligible = 1
    GROUP BY phone
  ) latest ON cj.phone = latest.phone AND cj.jobDate = latest.maxJobDate
  WHERE cj.reactivationEligible = 1
    AND cj.phone NOT IN (SELECT phone FROM sms_opt_outs)
  ORDER BY cj.jobDate DESC
  LIMIT 50
`);

// Deduplicate by phone
const seen = new Set();
const deduped = [];
for (const r of eligible) {
  if (!seen.has(r.phone)) {
    seen.add(r.phone);
    deduped.push(r);
  }
}

const unsent = deduped.filter(r => !sentPhones.has(r.phone));
console.log('Unsent contacts:', unsent.length);
unsent.forEach((r, i) => console.log((i+1) + ':', r.name, '|', r.phone));

console.log('\nStarting sends at 5/min (1 per 12s)...\n');

let sent = 0;
let failed = 0;

for (const contact of unsent) {
  const firstName = (contact.firstName || contact.name || 'there').split(' ')[0];
  const msg = SCRIPT.replace('{{name}}', firstName);

  try {
    const res = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': OPENPHONE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: [contact.phone],
        from: OPENPHONE_PHONE_NUMBER_ID,
        content: msg,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      sent++;
      console.log(`[${new Date().toLocaleTimeString()}] ✓ Sent to ${contact.name} (${contact.phone})`);

      // Create conversation session
      try {
        await conn.execute(
          `INSERT INTO conversation_sessions (leadPhone, leadName, stage, leadSource, messageHistory, aiMode, isBooked, reactivationLastPrice, serviceType)
           VALUES (?, ?, 'REACTIVATION', 'campaign:tomorrow_slots', ?, 1, 0, ?, ?)`,
          [
            contact.phone,
            contact.name || '',
            JSON.stringify([{ role: 'assistant', content: msg, ts: Date.now() }]),
            contact.lastBookingPrice || null,
            contact.serviceType || contact.frequency || null,
          ]
        );
      } catch (sessionErr) {
        console.log(`  (session create failed: ${sessionErr.message})`);
      }
    } else {
      failed++;
      console.log(`[${new Date().toLocaleTimeString()}] ✗ FAILED ${contact.name} (${contact.phone}): ${JSON.stringify(data)}`);
    }
  } catch (err) {
    failed++;
    console.log(`[${new Date().toLocaleTimeString()}] ✗ ERROR ${contact.name}: ${err.message}`);
  }

  // 12s throttle between sends
  if (unsent.indexOf(contact) < unsent.length - 1) {
    await new Promise(r => setTimeout(r, 12000));
  }
}

console.log(`\nDone. Sent: ${sent} | Failed: ${failed}`);
await conn.end();
