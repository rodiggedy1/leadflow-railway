/**
 * Investigates today's bookings revenue in conversation_sessions.
 * Mirrors the exact logic of getDashboardStats / calcRevenue in commandCenterRouter.ts
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";

// Load env from project
dotenv.config({ path: "/home/ubuntu/leadflow-quote-form/.env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

// ─── 1. Today's window (mirrors getWindowStart("today")) ──────────────────────
// The server uses: new Date(), setHours(0,0,0,0) — this is LOCAL server time.
// Server is likely UTC, so "today" = UTC midnight to now.
const now = new Date();
const todayStart = new Date(now);
todayStart.setHours(0, 0, 0, 0);
console.log("Today window start (server local):", todayStart.toISOString());
console.log("Now:", now.toISOString());

const NON_LEAD_SOURCES = [
  "cs_initiated",
  "cs-inbound",
  "cs-inbound-cleaner",
  "hiring_interview",
  "review",
  "review_rebooking",
];
const placeholders = NON_LEAD_SOURCES.map(() => "?").join(", ");

// ─── 2. All sessions created today (same filter as getDashboardStats) ──────────
const [allToday] = await conn.execute(
  `SELECT id, stage, isBooked, quotedPrice, extras, bookedAmount,
          reactivationLastPrice, reactivationDiscountPct, leadSource, leadName, leadPhone
   FROM conversation_sessions
   WHERE createdAt >= ?
     AND leadSource NOT IN (${placeholders})
   ORDER BY createdAt DESC`,
  [todayStart, ...NON_LEAD_SOURCES]
);

console.log("\n=== ALL sessions created today (non-review) ===");
console.log(`Total: ${allToday.length}`);
for (const s of allToday) {
  console.log(`  id=${s.id} stage=${s.stage} isBooked=${s.isBooked} leadSource=${s.leadSource} name=${s.leadName} phone=${s.leadPhone}`);
  console.log(`    bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} extras=${s.extras}`);
}

// ─── 3. Booked sessions only (stage=BOOKED or isBooked=1) ─────────────────────
const bookedSessions = allToday.filter(s => s.stage === "BOOKED" || s.isBooked === 1);
console.log(`\n=== BOOKED sessions today: ${bookedSessions.length} ===`);

// ─── 4. calcRevenue for each booked session (mirrors server logic exactly) ────
function calcRevenue(row) {
  if (row.bookedAmount != null) return Number(row.bookedAmount);
  if (row.quotedPrice != null && row.quotedPrice !== "") {
    const base = parseFloat(row.quotedPrice);
    let extrasTotal = 0;
    try {
      const keys = JSON.parse(row.extras ?? "[]");
      extrasTotal = keys.length * 30;
    } catch {}
    return (isNaN(base) ? 0 : base) + extrasTotal;
  }
  if (row.reactivationLastPrice != null) {
    const discountPct = row.reactivationDiscountPct ?? 10;
    return Math.round(row.reactivationLastPrice * (1 - discountPct / 100));
  }
  return 0;
}

let totalRevenue = 0;
for (const s of bookedSessions) {
  const rev = calcRevenue(s);
  totalRevenue += rev;
  console.log(`  id=${s.id} name=${s.leadName} stage=${s.stage} isBooked=${s.isBooked}`);
  console.log(`    bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} extras=${s.extras} → calcRevenue=$${rev}`);
}
console.log(`\n=== TOTAL bookedRevenue (getDashboardStats "today"): $${totalRevenue} ===`);

// ─── 5. Also check: are there ANY sessions with isBooked=1 today regardless of stage? ──
const [isBookedRows] = await conn.execute(
  `SELECT id, stage, isBooked, bookedAmount, quotedPrice, leadName, leadSource, createdAt
   FROM conversation_sessions
   WHERE isBooked = 1
     AND createdAt >= ?
   ORDER BY createdAt DESC`,
  [todayStart]
);
console.log(`\n=== Sessions with isBooked=1 created today: ${isBookedRows.length} ===`);
for (const s of isBookedRows) {
  console.log(`  id=${s.id} stage=${s.stage} name=${s.leadName} bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} source=${s.leadSource}`);
}

// ─── 6. Check: sessions with isBooked=1 that were UPDATED today (not just created) ──
const [updatedToday] = await conn.execute(
  `SELECT id, stage, isBooked, bookedAmount, quotedPrice, leadName, leadSource, createdAt, updatedAt
   FROM conversation_sessions
   WHERE isBooked = 1
     AND updatedAt >= ?
   ORDER BY updatedAt DESC
   LIMIT 20`,
  [todayStart]
);
console.log(`\n=== Sessions with isBooked=1 UPDATED today (any creation date): ${updatedToday.length} ===`);
for (const s of updatedToday) {
  console.log(`  id=${s.id} stage=${s.stage} name=${s.leadName} bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} source=${s.leadSource}`);
  console.log(`    createdAt=${s.createdAt} updatedAt=${s.updatedAt}`);
}

await conn.end();
