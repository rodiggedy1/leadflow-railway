/**
 * Investigates today's bookings revenue using the exact same logic as leads.stats
 * in routers.ts — specifically using bookedAt (not createdAt) for the date filter.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config({ path: "/home/ubuntu/leadflow-quote-form/.env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

// ─── Replicate estOffsetMs ─────────────────────────────────────────────────────
function estOffsetMs(date) {
  // Get the UTC offset for America/New_York at the given date
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const etStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  const utcDate = new Date(utcStr);
  const etDate = new Date(etStr);
  return utcDate.getTime() - etDate.getTime();
}

// ─── Today's date string in ET (same as CommandChat.tsx) ─────────────────────
const todayDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
console.log("Today (ET):", todayDateStr);

// ─── buildBookedDateConditions equivalent ─────────────────────────────────────
const midnightUtcFrom = new Date(todayDateStr + "T00:00:00.000Z");
const from = new Date(midnightUtcFrom.getTime() - estOffsetMs(midnightUtcFrom));
const endUtcTo = new Date(todayDateStr + "T23:59:59.999Z");
const to = new Date(endUtcTo.getTime() - estOffsetMs(endUtcTo));

console.log("bookedAt >= ", from.toISOString());
console.log("bookedAt <= ", to.toISOString());

// ─── Query: all sessions with stage=BOOKED and bookedAt in today's ET window ──
const [bookedRows] = await conn.execute(
  `SELECT id, stage, isBooked, bookedAt, bookedAmount, quotedPrice, extras,
          reactivationLastPrice, reactivationDiscountPct, leadSource, leadName, leadPhone, createdAt
   FROM conversation_sessions
   WHERE stage = 'BOOKED'
     AND bookedAt >= ?
     AND bookedAt <= ?
   ORDER BY bookedAt DESC`,
  [from, to]
);

console.log(`\n=== Sessions with stage=BOOKED and bookedAt today (ET): ${bookedRows.length} ===`);

function calcBookedRevenue(row) {
  if (row.bookedAmount != null && row.bookedAmount !== 0) return Number(row.bookedAmount);
  if (row.quotedPrice != null && row.quotedPrice !== "" && row.quotedPrice !== "custom") {
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
for (const s of bookedRows) {
  const rev = calcBookedRevenue(s);
  totalRevenue += rev;
  console.log(`  id=${s.id} name=${s.leadName} bookedAt=${s.bookedAt} bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} → $${rev}`);
}
console.log(`\n=== TOTAL bookedRevenue (leads.stats "today"): $${totalRevenue} ===`);

// ─── Also check: what does calcBookedRevenue look like in routers.ts? ─────────
// Let's also look at ALL booked sessions regardless of date to understand the $510
const [allBooked] = await conn.execute(
  `SELECT id, stage, isBooked, bookedAt, bookedAmount, quotedPrice, extras,
          reactivationLastPrice, reactivationDiscountPct, leadSource, leadName, leadPhone, createdAt
   FROM conversation_sessions
   WHERE stage = 'BOOKED'
   ORDER BY bookedAt DESC
   LIMIT 20`
);

console.log(`\n=== Most recent 20 BOOKED sessions (any date) ===`);
for (const s of allBooked) {
  const rev = calcBookedRevenue(s);
  console.log(`  id=${s.id} name=${s.leadName} bookedAt=${s.bookedAt} createdAt=${s.createdAt} bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} → $${rev}`);
}

// ─── Check: any sessions booked in the last 48 hours ─────────────────────────
const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
const [recent] = await conn.execute(
  `SELECT id, stage, isBooked, bookedAt, bookedAmount, quotedPrice, leadName, leadSource, createdAt
   FROM conversation_sessions
   WHERE (stage = 'BOOKED' OR isBooked = 1)
     AND (bookedAt >= ? OR updatedAt >= ?)
   ORDER BY COALESCE(bookedAt, updatedAt) DESC
   LIMIT 20`,
  [fortyEightHoursAgo, fortyEightHoursAgo]
);
console.log(`\n=== Sessions booked/updated in last 48h: ${recent.length} ===`);
for (const s of recent) {
  const rev = calcBookedRevenue(s);
  console.log(`  id=${s.id} name=${s.leadName} stage=${s.stage} bookedAt=${s.bookedAt} bookedAmount=${s.bookedAmount} quotedPrice=${s.quotedPrice} → $${rev}`);
}

await conn.end();
