import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
const conn = await createConnection(process.env.DATABASE_URL);

// The key question: 
// Session 1470076 (hiring_interview) was created Apr 9 18:06
// Session 1470095 (cs-inbound) was created Apr 10 01:26 
// The cs-inbound session has the "Real Interview" SMS as its FIRST message (assistant role)
// This means: the updateStage "Real Interview" SMS was sent from the MAIN number
// When Aubrey replied, the webhook found the hiring_interview session (INTERVIEW_LINK_SENT stage)
// and correctly stored the reply there.
// BUT the updateStage code appended the SMS to the MOST RECENT session...
// At the time of updateStage, the most recent session was 1470076 (hiring_interview)
// So the "Real Interview" SMS was appended to 1470076 AND also sent via OpenPhone from MAIN number
// When Aubrey replied "I am free let me know what works for you" - this went to the CS number (PN0wVLcpCq)
// because the updateStage SMS was also sent via the CS number somehow?

// Let me check: the cs-inbound session 1470095 was created at 01:26 
// The first message in cs-inbound is the "Real Interview" SMS (assistant)
// The first user reply is "I am free let me know what works for you" at 01:26
// This means: the "Real Interview" SMS was sent from the CS number (PN0wVLcpCq)
// and when Aubrey replied to that CS number, it created a new cs-inbound session

// BUT WAIT - the updateStage sendSms has NO fromNumberId override, so it uses the MAIN number
// So why did Aubrey's reply go to the CS number?

// Let me check: maybe the sendCandidateMessage was used instead of updateStage
// sendCandidateMessage uses fromNumberId: "PN0wVLcpCq" (CS number)
// And it finds the MOST RECENT session regardless of leadSource

// Check: when was session 1470095 created vs the messages in it
const [rows] = await conn.execute(
  "SELECT id, leadSource, stage, createdAt, messageHistory FROM conversation_sessions WHERE id = 1470095"
);
const s = rows[0];
let msgs = [];
try { msgs = JSON.parse(s.messageHistory || '[]'); } catch {}
console.log(`Session 1470095: ${s.leadSource}, stage=${s.stage}, created=${s.createdAt}`);
msgs.forEach(m => console.log(`  [${m.role}] ts=${m.ts} ${new Date(m.ts||0).toISOString()} ${String(m.content).slice(0,100)}`));

// The first assistant message ts=1775781732228 = 2026-04-10T00:42:12Z
// The session was created at 01:26:34 EDT = 05:26:34 UTC = 2026-04-10T05:26:34Z
// Wait, that doesn't match. Let me check the timezone

console.log('\nTimestamp analysis:');
console.log('First assistant ts:', 1775781732228, '=', new Date(1775781732228).toISOString());
console.log('Session created:', s.createdAt);
console.log('First user reply ts:', 1775784393625, '=', new Date(1775784393625).toISOString());

await conn.end();
