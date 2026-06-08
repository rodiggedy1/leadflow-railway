import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SCRIPT = "Hi {{name}}, it's Jade from Maids in Black! 👋 We have a last-minute opening tomorrow. Offering a discounted clean to leave your home sparkling. ✨ Want me to grab it for you?";

// Next 48 confirmed unsent contacts (Stefan opted out, skipped)
const CONTACTS = [
  { name: 'Brendan Meehan',        phone: '+15712161878' },
  { name: 'Kyle Sullivan',          phone: '+14018080008' },
  { name: 'Abiy Worku',             phone: '+17034016969' },
  { name: 'Jonathan Aries',         phone: '+13016417532' },
  { name: 'Cara Wirth',             phone: '+15613890514' },
  { name: 'Matija Jevtic',          phone: '+12404474608' },
  { name: 'Emily Druckman',         phone: '+13045467843' },
  { name: 'Dave Mitrani',           phone: '+19084486776' },
  { name: 'Mary Wessendorf',        phone: '+17035419434' },
  { name: 'Tali Cohen',             phone: '+12023296726' },
  { name: 'David Branson',          phone: '+15713543376' },
  { name: 'Daniel Foster',          phone: '+16158488189' },
  { name: 'Andrew Macurak',         phone: '+17245133792' },
  { name: 'Nancy Okail',            phone: '+12024923693' },
  { name: 'Derek khanna',           phone: '+18325370189' },
  { name: 'Derek khanna',           phone: '+12025794254' },
  { name: 'Laura Hayes',            phone: '+14845352720' },
  { name: 'riz gamela',             phone: '+19499238509' },
  { name: 'Sarah Ruckriegle',       phone: '+19703892414' },
  { name: 'riz gamela',             phone: '+12564965261' },
  { name: 'Chasseny Lewis',         phone: '+12026790309' },
  { name: 'Elizabeth Cutler',       phone: '+16105139999' },
  { name: 'James Kvaal',            phone: '+16179575756' },
  { name: 'Rebecca Balsam',         phone: '+14349816610' },
  { name: 'Emily McAndrew',         phone: '+16152945048' },
  { name: 'Knox Greene',            phone: '+17133806631' },
  { name: 'Ted Scallet',            phone: '+12023296399' },
  { name: 'Paul Goldstein',         phone: '+16515875233' },
  { name: 'Marcus Cross',           phone: '+13123394270' },
  { name: 'Lisa Banusiewicz',       phone: '+12023049098' },
  { name: 'Jessica Blessing',       phone: '+14109083238' },
  { name: 'Charese Williams',       phone: '+13012374714' },
  { name: 'Emmett Moore',           phone: '+15712473727' },
  { name: 'Erik Kinney',            phone: '+12629934450' },
  { name: 'HAROLD FORD',            phone: '+13053017318' },
  { name: 'Karl Engemann',          phone: '+19145224514' },
  { name: 'Aaron Hemphill',         phone: '+16158533673' },
  { name: 'Olivia Vega',            phone: '+12393311801' },
  { name: 'Emily Wells',            phone: '+18315887240' },
  { name: 'Ross Powers',            phone: '+17033508599' },
  { name: 'Amy Reingold',           phone: '+12022582430' },
  { name: 'Jimmy Moore',            phone: '+19014915675' },
  { name: 'Audrey Henson',          phone: '+17274245480' },
  { name: 'Quinn Comstock',         phone: '+13607919017' },
  { name: 'Katharyn Caldwell',      phone: '+19725715102' },
  { name: 'Rania S',                phone: '+12024604020' },
  { name: 'James Carden',           phone: '+16467551575' },
  { name: 'Abigail Denburg',        phone: '+19179232204' },
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID;

console.log('Sending to', CONTACTS.length, 'contacts at 5/min...\n');

let sent = 0;
let failed = 0;

for (let i = 0; i < CONTACTS.length; i++) {
  const contact = CONTACTS[i];
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
      console.log(`[${new Date().toLocaleTimeString()}] ✓ ${sent}/${CONTACTS.length} Sent to ${contact.name} (${contact.phone})`);
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
        // non-fatal
      }
    } else {
      failed++;
      console.log(`[${new Date().toLocaleTimeString()}] ✗ FAILED ${contact.name} (${contact.phone}): ${JSON.stringify(data)}`);
    }
  } catch (err) {
    failed++;
    console.log(`[${new Date().toLocaleTimeString()}] ✗ ERROR ${contact.name}: ${err.message}`);
  }

  if (i < CONTACTS.length - 1) {
    await new Promise(r => setTimeout(r, 12000));
  }
}

console.log(`\nDone. Sent: ${sent} | Failed: ${failed}`);
await conn.end();
