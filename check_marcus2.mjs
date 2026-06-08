import { createConnection } from "mysql2/promise";
const db = await createConnection(process.env.DATABASE_URL);

const [rows] = await db.execute(
  "SELECT id, leadName, leadSource, stage, isBooked, bookedAt, bookedAmount, quotedPrice, createdAt FROM conversation_sessions WHERE id = 2400114"
);
console.log("Marcus Howard session:", JSON.stringify(rows, null, 2));

const today = new Date().toISOString().split('T')[0];
console.log("Today:", today);

const etOffset = 4 * 60 * 60 * 1000;
const midnightUtc = new Date(today + "T00:00:00.000Z");
const from = new Date(midnightUtc.getTime() - etOffset);
const endUtc = new Date(today + "T23:59:59.999Z");
const to = new Date(endUtc.getTime() - etOffset);
console.log("bookedAt range (UTC):", from.toISOString(), "to", to.toISOString());
console.log("Marcus bookedAt:", rows[0]?.bookedAt);

await db.end();
