/**
 * debug_brian.mjs — trace exactly what runSyncTodayJobs does for booking 444063 (Brian Nixon)
 */
import { createRequire } from "module";
import { config } from "dotenv";
config();

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const date = "2026-05-03";
const bookingId = 444063;

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Current DB state for Brian Nixon
const [rows] = await conn.execute(
  "SELECT id, bookingId, customerName, bookingStatus, cleanerProfileId, teamName, jobDate FROM cleaner_jobs WHERE bookingId = ? AND jobDate = ?",
  [bookingId, date]
);
console.log("Current DB rows for booking 444063:");
for (const r of rows) console.log(" ", r);

// 2. What profile does "Team Solange" resolve to?
const [profiles] = await conn.execute(
  "SELECT id, name, payPercent FROM cleaner_profiles WHERE name = 'Team Solange' LIMIT 1"
);
console.log("\nTeam Solange profile:");
for (const p of profiles) console.log(" ", p);

// 3. What would the sync find when looking for existing row?
if (profiles.length > 0) {
  const profileId = profiles[0].id;
  const [existing] = await conn.execute(
    "SELECT id, bookingStatus FROM cleaner_jobs WHERE bookingId = ? AND cleanerProfileId = ? LIMIT 1",
    [bookingId, profileId]
  );
  console.log("\nExisting row found by sync (bookingId + cleanerProfileId):");
  for (const e of existing) console.log(" ", e);
  
  if (existing.length > 0) {
    const prev = existing[0].bookingStatus;
    const isTerminal = prev === "completed" || prev === "cancelled";
    console.log(`\npreviousStatus = '${prev}'`);
    console.log(`isTerminalStatus = ${isTerminal}`);
    console.log(`Would sync overwrite bookingStatus? ${!isTerminal ? "YES → assigned" : "NO (terminal)"}`);
  }
}

await conn.end();
