import { createConnection } from "mysql2/promise";
const db = await createConnection(process.env.DATABASE_URL);

// Simulate the exact query that leads.stats runs for today
const today = "2026-05-23";

// ET offset for today
function estOffsetMs(utcDate) {
  const etStr = utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const [datePart, timePart] = etStr.split(", ");
  const [mo, dy, yr] = datePart.split("/");
  const etAsUtc = new Date(`${yr}-${mo}-${dy}T${timePart}Z`);
  return etAsUtc.getTime() - utcDate.getTime();
}

const midnightUtc = new Date(today + "T00:00:00.000Z");
const from = new Date(midnightUtc.getTime() - estOffsetMs(midnightUtc));
const endUtc = new Date(today + "T23:59:59.999Z");
const to = new Date(endUtc.getTime() - estOffsetMs(endUtc));
console.log("bookedAt range:", from.toISOString(), "to", to.toISOString());

// Run the exact query with isBooked=1 and the organic filter for thumbtack
const [rows] = await db.execute(
  `SELECT id, leadName, leadSource, stage, isBooked, bookedAt, bookedAmount, quotedPrice
   FROM conversation_sessions
   WHERE isBooked = 1
     AND bookedAt >= ? AND bookedAt <= ?
     AND (leadSource IS NULL OR leadSource NOT IN ('cs-inbound', 'cs-inbound-cleaner', 'review'))
     AND (
       leadSource IS NULL OR (
         leadSource NOT LIKE 'always-on%' AND
         leadSource NOT LIKE 'campaign:%' AND
         leadSource NOT IN ('reactivation', 'command-center', 'review', 'review_rebooking')
       )
     )
   ORDER BY bookedAt DESC`,
  [from, to]
);
console.log("Booked today (organic):", JSON.stringify(rows, null, 2));
await db.end();
