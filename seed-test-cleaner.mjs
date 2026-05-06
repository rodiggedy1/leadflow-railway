/**
 * Creates a test cleaner account (test@test.com / Test1234!) and a fake job
 * for today with client phone 302-981-6191 so ETA/SMS flows can be tested.
 */
import { createConnection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// ── 1. Upsert the test cleaner profile ───────────────────────────────────────
const email = "test@test.com";
const password = "Test1234!";
const hash = await bcrypt.hash(password, 10);

const [existing] = await conn.execute(
  "SELECT id FROM cleaner_profiles WHERE email = ?",
  [email]
);

let cleanerId;
if (existing.length > 0) {
  cleanerId = existing[0].id;
  await conn.execute(
    "UPDATE cleaner_profiles SET passwordHash = ?, isActive = 1 WHERE id = ?",
    [hash, cleanerId]
  );
  console.log(`✓ Updated existing test cleaner (id=${cleanerId})`);
} else {
  const [result] = await conn.execute(
    `INSERT INTO cleaner_profiles (name, email, phone, isActive, passwordHash)
     VALUES ('Test Cleaner', ?, '3029816191', 1, ?)`,
    [email, hash]
  );
  cleanerId = result.insertId;
  console.log(`✓ Created test cleaner (id=${cleanerId})`);
}

// ── 2. Get today's date in ET ─────────────────────────────────────────────────
const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
console.log(`Today (ET): ${todayET}`);

// ── 3. Remove any existing test jobs for today to avoid duplicate key errors ──
await conn.execute(
  "DELETE FROM cleaner_jobs WHERE cleanerProfileId = ? AND jobDate = ?",
  [cleanerId, todayET]
);

// ── 4. We need a completedJobId — use a placeholder (0 is fine for testing) ──
// The unique constraint is on (bookingId, cleanerProfileId) — use null bookingId
// to avoid conflicts with real jobs.
const serviceTime = `${todayET}T10:00:00`;

const [jobResult] = await conn.execute(
  `INSERT INTO cleaner_jobs
     (completedJobId, bookingId, cleanerProfileId, cleanerName, jobDate,
      serviceDateTime, customerName, customerPhone, jobAddress, serviceType,
      bedrooms, bathrooms, bookingStatus, jobRevenue, payPercent, basePay,
      photoSubmitted, flagged, noEtaArrival, complaintChargeApplied, scheduleConfirmed)
   VALUES
     (0, NULL, ?, 'Test Cleaner', ?,
      ?, 'Rohan Test Client', '3029816191', '123 Test Street NW, Washington DC 20001', '2 Bedroom, 2 Bathroom',
      2, 2, 'assigned', '180.00', '55', '99.00',
      0, 0, 0, 0, 0)`,
  [cleanerId, todayET, serviceTime]
);

const jobId = jobResult.insertId;
console.log(`✓ Created test job (id=${jobId}) for ${todayET}`);
console.log(`\n──────────────────────────────────────`);
console.log(`TEST CLEANER LOGIN`);
console.log(`  Email:    test@test.com`);
console.log(`  Password: Test1234!`);
console.log(`  Login at: /cleaner`);
console.log(`\nFAKE JOB`);
console.log(`  Customer: Rohan Test Client`);
console.log(`  Phone:    302-981-6191`);
console.log(`  Address:  123 Test Street NW, Washington DC 20001`);
console.log(`  Date:     ${todayET} at 10:00 AM`);
console.log(`──────────────────────────────────────\n`);

await conn.end();
