import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
const conn = await createConnection(process.env.DATABASE_URL);

// Simulate the leads.list query filter - does hiring_interview show up?
// The filter is: NOT IN ('cs-inbound', 'cs-inbound-cleaner') AND NOT = 'review'
// AND one of:
//   - leadSource IS NULL
//   - NOT LIKE 'always-on%' AND NOT LIKE 'campaign:%' AND NOT IN ('reactivation', 'command-center', 'review', 'review_rebooking')
//   - campaign sources with user reply
//   - review_rebooking with user reply
// hiring_interview matches the second OR branch, so it DOES show in leads list

const [rows] = await conn.execute(`
  SELECT id, leadPhone, leadSource, stage 
  FROM conversation_sessions 
  WHERE leadSource = 'hiring_interview'
  AND (leadSource IS NULL OR leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner'))
  AND (leadSource IS NULL OR leadSource != 'review')
  AND (
    leadSource IS NULL
    OR (
      leadSource IS NOT NULL
      AND leadSource NOT LIKE 'always-on%'
      AND leadSource NOT LIKE 'campaign:%'
      AND leadSource NOT IN ('reactivation', 'command-center', 'review', 'review_rebooking')
    )
  )
  LIMIT 5
`);
console.log('hiring_interview sessions that appear in leads list:', rows.length);
rows.forEach(r => console.log(`  id=${r.id} phone=${r.leadPhone} stage=${r.stage}`));

await conn.end();
