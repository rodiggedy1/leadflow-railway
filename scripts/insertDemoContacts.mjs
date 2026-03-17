/**
 * Inserts one sample demo contact per always-on group.
 * Uses +1555 numbers (non-dialable) so they never accidentally send real SMS.
 * These are for UI preview only — the "Test Message" button uses the admin's real phone.
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get group IDs
const [groups] = await conn.execute(
  "SELECT id, groupType FROM always_on_groups ORDER BY id"
);

console.log("Groups found:", groups.map(g => `${g.id}:${g.groupType}`).join(", "));

// Get a real completed_job to use as the completedJobId reference
const [jobs] = await conn.execute(
  "SELECT id FROM completed_jobs LIMIT 1"
);
const sampleJobId = jobs[0]?.id ?? 1;

// Demo contacts — one per group
const demoContacts = [
  {
    groupType: "new-one-time",
    firstName: "Emma",
    name: "Emma Demo",
    phone: "+15550000001",
    frequency: "One Time",
    lastBookingPrice: 15000, // $150 in cents
    discountPct: 10,
    jobDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 3 days ago
  },
  {
    groupType: "lapsed-one-time",
    firstName: "James",
    name: "James Demo",
    phone: "+15550000002",
    frequency: "One Time",
    lastBookingPrice: 18000, // $180 in cents
    discountPct: 10,
    jobDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 25 days ago
  },
  {
    groupType: "lapsed-recurring",
    firstName: "Maria",
    name: "Maria Demo",
    phone: "+15550000003",
    frequency: "Monthly",
    lastBookingPrice: 16000, // $160 in cents
    discountPct: 15,
    jobDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 45 days ago
  },
  {
    groupType: "dormant",
    firstName: "Robert",
    name: "Robert Demo",
    phone: "+15550000004",
    frequency: "One Time",
    lastBookingPrice: 12000, // $120 in cents
    discountPct: 20,
    jobDate: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], // 400 days ago
  },
];

let inserted = 0;
for (const demo of demoContacts) {
  // Find the matching group ID
  const group = groups.find(g => g.groupType === demo.groupType);
  if (!group) {
    console.warn(`No group found for type: ${demo.groupType}`);
    continue;
  }

  // Check if demo contact already exists
  const [existing] = await conn.execute(
    "SELECT id FROM always_on_enrollments WHERE phone = ? AND groupId = ?",
    [demo.phone, group.id]
  );

  if (existing.length > 0) {
    console.log(`Demo contact ${demo.name} already exists for group ${demo.groupType} — skipping`);
    continue;
  }

  await conn.execute(
    `INSERT INTO always_on_enrollments 
     (groupId, completedJobId, phone, firstName, name, frequency, lastBookingPrice, discountPct, status, jobDate, enrolledAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NOW())`,
    [
      group.id,
      sampleJobId,
      demo.phone,
      demo.firstName,
      demo.name,
      demo.frequency,
      demo.lastBookingPrice,
      demo.discountPct,
      demo.jobDate,
    ]
  );

  console.log(`✓ Inserted demo contact: ${demo.name} (${demo.groupType}) — ${demo.phone}`);
  inserted++;
}

await conn.end();
console.log(`\nDone. Inserted ${inserted} demo contacts.`);
