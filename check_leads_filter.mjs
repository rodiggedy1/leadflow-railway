import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
const conn = await createConnection(process.env.DATABASE_URL);

// Check if hiring_interview sessions appear in the leads list query
// The filter allows non-campaign sources that are NOT in the exclusion list
// hiring_interview is NOT in ('cs-inbound', 'cs-inbound-cleaner', 'review', 'reactivation', 'command-center', 'review_rebooking')
// So it WOULD show up in the leads list
const [rows] = await conn.execute(
  "SELECT id, leadPhone, leadSource, stage FROM conversation_sessions WHERE leadSource = 'hiring_interview' LIMIT 10"
);
console.log('hiring_interview sessions:', rows.length);
rows.forEach(r => console.log(`  id=${r.id} phone=${r.leadPhone} stage=${r.stage}`));

// Also check cs-inbound sessions for hiring candidates
const [rows2] = await conn.execute(
  "SELECT id, leadPhone, leadSource, stage FROM conversation_sessions WHERE leadSource = 'cs-inbound' AND stage IN ('OPEN', 'INTERVIEW_LINK_SENT') LIMIT 10"
);
console.log('\ncs-inbound sessions with hiring stages:', rows2.length);
rows2.forEach(r => console.log(`  id=${r.id} phone=${r.leadPhone} stage=${r.stage}`));

await conn.end();
