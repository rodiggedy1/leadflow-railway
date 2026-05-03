import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const db = await createConnection(process.env.DATABASE_URL);

// 1. Total sessions that match the enrollment query criteria (same WHERE as nurtureCron)
const [totalEligible] = await db.execute(`
  SELECT COUNT(*) as cnt
  FROM conversation_sessions
  WHERE (leadSource IS NULL OR leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))
  AND createdAt > '2026-04-29 15:00:00'
`);
console.log('Total eligible sessions (match WHERE clause):', totalEligible[0].cnt);

// 2. How many of those are already enrolled (any status including deleted)
const [alreadyEnrolled] = await db.execute(`
  SELECT COUNT(DISTINCT cs.id) as cnt
  FROM conversation_sessions cs
  INNER JOIN nurture_enrollments ne ON ne.sessionId = cs.id
  WHERE (cs.leadSource IS NULL OR cs.leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))
  AND cs.createdAt > '2026-04-29 15:00:00'
`);
console.log('Already enrolled (any status):', alreadyEnrolled[0].cnt);

// 3. How many would be NEW enrollments (not enrolled, not booked, not opted out)
const [newEnrollments] = await db.execute(`
  SELECT COUNT(*) as cnt
  FROM conversation_sessions cs
  LEFT JOIN nurture_enrollments ne ON ne.sessionId = cs.id
  WHERE (cs.leadSource IS NULL OR cs.leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))
  AND cs.createdAt > '2026-04-29 15:00:00'
  AND ne.id IS NULL
  AND cs.stage NOT IN ('BOOKED', 'COMPLETED', 'CLOSED')
  AND cs.isBooked = 0
`);
console.log('Would be newly enrolled (unenrolled, not booked):', newEnrollments[0].cnt);

// 4. Show those unenrolled sessions — name, phone, stage, age
const [unenrolledSessions] = await db.execute(`
  SELECT cs.id, cs.leadName, cs.leadPhone, cs.stage, cs.leadSource, cs.createdAt,
    TIMESTAMPDIFF(HOUR, cs.createdAt, NOW()) as ageHours
  FROM conversation_sessions cs
  LEFT JOIN nurture_enrollments ne ON ne.sessionId = cs.id
  WHERE (cs.leadSource IS NULL OR cs.leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))
  AND cs.createdAt > '2026-04-29 15:00:00'
  AND ne.id IS NULL
  AND cs.stage NOT IN ('BOOKED', 'COMPLETED', 'CLOSED')
  AND cs.isBooked = 0
  ORDER BY cs.createdAt DESC
  LIMIT 50
`);
console.log('\nUnenrolled sessions (newest first):');
for (const s of unenrolledSessions) {
  console.log(`  [${s.id}] ${s.leadName} | ${s.leadPhone} | stage=${s.stage} | source=${s.leadSource} | age=${s.ageHours}h`);
}

// 5. Check the current limit(100) — what sessions does it actually return (oldest first)?
const [currentBatch] = await db.execute(`
  SELECT cs.id, cs.leadName, cs.createdAt
  FROM conversation_sessions cs
  WHERE (cs.leadSource IS NULL OR cs.leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'cs_initiated', 'hiring_interview', 'review', 'review_rebooking'))
  AND cs.createdAt > '2026-04-29 15:00:00'
  LIMIT 100
`);
console.log('\nCurrent batch (no ORDER BY, limit 100) — first and last:');
console.log('  First:', currentBatch[0]?.leadName, currentBatch[0]?.createdAt);
console.log('  Last:', currentBatch[currentBatch.length-1]?.leadName, currentBatch[currentBatch.length-1]?.createdAt);

await db.end();
