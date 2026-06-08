import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SCRIPT = "Hi {{name}}, it's Jade from Maids in Black! 👋 We have a last-minute opening tomorrow. Offering a discounted clean to leave your home sparkling. ✨ Want me to grab it for you?";

// Exact 20 contacts confirmed unsent — hardcoded to avoid any DB lookup mismatch
const UNSENT = [
  { name: 'Samuel Callahan',        phone: '+16512381053' },
  { name: 'Lauren Brinkley',        phone: '+13018078050' },
  { name: 'Rebekah Siliezar',       phone: '+17088221437' },
  { name: 'Catherine Aponte',       phone: '+18628123670' },
  { name: 'EBONEE BACHMAN',         phone: '+15402302566' },
  { name: 'Aaron Edejer',           phone: '+17039667004' },
  { name: 'Amari Greenwhite',       phone: '+12406068158' },
  { name: 'Woinam Tereffe',         phone: '+17039538050' },
  { name: 'Maria Ronquillo',        phone: '+12408932262' },
  { name: 'Diana Yap',              phone: '+17034397658' },
  { name: 'Rose Baumann Baumann',   phone: '+16123963609' },
  { name: 'Alison Randall',         phone: '+16178230341' },
  { name: 'Natalie Aggarwal',       phone: '+13042826525' },
  { name: 'Pallavi Reddy',          phone: '+17349454480' },
  { name: 'Anna Deffebach',         phone: '+19712755215' },
  { name: 'Stefan saleksevigch',    phone: '+15027418343' },
  { name: 'Erica Evans Evans',      phone: '+14434211234' },
  { name: 'Delaney Son',            phone: '+13304233424' },
  { name: 'Lisa Lytton',            phone: '+14349870417' },
  { name: 'Adrian Spenscer Smith',  phone: '+12179792152' },
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID;

console.log('Sending to', UNSENT.length, 'contacts at 5/min...\n');

let sent = 0;
let failed = 0;

for (let i = 0; i < UNSENT.length; i++) {
  const contact = UNSENT[i];
  const firstName = contact.name.split(' ')[0];
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
      console.log(`[${new Date().toLocaleTimeString()}] ✓ ${sent}/20 Sent to ${contact.name} (${contact.phone})`);
      try {
        await conn.execute(
          `INSERT INTO conversation_sessions (leadPhone, leadName, stage, leadSource, messageHistory, aiMode, isBooked)
           VALUES (?, ?, 'REACTIVATION', 'campaign:tomorrow_slots', ?, 1, 0)`,
          [
            contact.phone,
            contact.name,
            JSON.stringify([{ role: 'assistant', content: msg, ts: Date.now() }]),
          ]
        );
      } catch (e) {
        console.log(`  (session note: ${e.message})`);
      }
    } else {
      failed++;
      console.log(`[${new Date().toLocaleTimeString()}] ✗ FAILED ${contact.name}: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    failed++;
    console.log(`[${new Date().toLocaleTimeString()}] ✗ ERROR ${contact.name}: ${err.message}`);
  }

  if (i < UNSENT.length - 1) {
    await new Promise(r => setTimeout(r, 12000));
  }
}

console.log(`\nDone. Sent: ${sent} | Failed: ${failed}`);
await conn.end();
