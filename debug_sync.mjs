/**
 * debug_sync.mjs — compare Launch27 bookings for a date vs what's in the DB
 * Usage: node debug_sync.mjs [YYYY-MM-DD]
 */
import { createRequire } from "module";
import { config } from "dotenv";
config();

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const date = process.argv[2] ?? "2026-05-03";

// ── 1. Fetch from Launch27 ────────────────────────────────────────────────────
const subdomain = process.env.LAUNCH27_TENANT || "maidsinblack";
const bearer = process.env.LAUNCH27_BEARER_TOKEN;
if (!bearer) { console.error("LAUNCH27_BEARER_TOKEN not set"); process.exit(1); }

const baseUrl = `https://${subdomain}.launch27.com`;

async function fetchL27(includeAll) {
  const allBookings = [];
  let offset = 0;
  const limit = 20;
  while (true) {
    const params = new URLSearchParams({
      from: date, to: date,
      ...(includeAll ? {} : { options: "completed,exclude_forecasted" }),
      limit: String(limit), offset: String(offset), sort: "asc",
    });
    const url = `${baseUrl}/v1/staff/bookings?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    });
    if (!res.ok) { console.error("L27 error:", res.status, await res.text()); break; }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const b of raw) {
      allBookings.push({
        id: b.id,
        name: b.user?.name ?? `${b.user?.first_name ?? ""} ${b.user?.last_name ?? ""}`.trim(),
        phone: b.phone ?? "",
        status: b.booking_status ?? "?",
        completed: b.completed ?? false,
        serviceDate: b.service_date ?? date,
        teams: (b.teams ?? []).map(t => t.title),
      });
    }
    if (raw.length < limit) break;
    offset += limit;
  }
  return allBookings;
}

// ── 2. Fetch from DB ──────────────────────────────────────────────────────────
async function fetchDB() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    "SELECT bookingId, customerName, bookingStatus, teamName, jobDate FROM cleaner_jobs WHERE jobDate = ?",
    [date]
  );
  await conn.end();
  return rows;
}

// ── 3. Compare ────────────────────────────────────────────────────────────────
console.log(`\n=== Launch27 fetch for ${date} (includeAll=false / completed only) ===`);
const completedOnly = await fetchL27(false);
console.log(`Returned: ${completedOnly.length} bookings`);
for (const b of completedOnly) {
  console.log(`  [${b.id}] ${b.name} | status=${b.status} | completed=${b.completed} | teams=${b.teams.join(",")}`);
}

console.log(`\n=== Launch27 fetch for ${date} (includeAll=true / all statuses) ===`);
const allBookings = await fetchL27(true);
console.log(`Returned: ${allBookings.length} bookings`);
for (const b of allBookings) {
  console.log(`  [${b.id}] ${b.name} | status=${b.status} | completed=${b.completed} | teams=${b.teams.join(",")}`);
}

console.log(`\n=== DB cleaner_jobs for ${date} ===`);
const dbRows = await fetchDB();
console.log(`Rows in DB: ${dbRows.length}`);
for (const r of dbRows) {
  console.log(`  bookingId=${r.bookingId} | ${r.customerName} | status=${r.bookingStatus} | team=${r.teamName}`);
}

console.log(`\n=== MISSING from DB (in L27 allBookings but not in DB) ===`);
const dbBookingIds = new Set(dbRows.map(r => r.bookingId));
const missing = allBookings.filter(b => !dbBookingIds.has(b.id));
if (missing.length === 0) {
  console.log("  None — all L27 bookings are in the DB.");
} else {
  for (const b of missing) {
    console.log(`  MISSING: [${b.id}] ${b.name} | status=${b.status} | teams=${b.teams.join(",")}`);
  }
}

console.log(`\n=== In DB but NOT in L27 (stale rows) ===`);
const l27Ids = new Set(allBookings.map(b => b.id));
const stale = dbRows.filter(r => !l27Ids.has(r.bookingId));
if (stale.length === 0) {
  console.log("  None.");
} else {
  for (const r of stale) {
    console.log(`  STALE: bookingId=${r.bookingId} | ${r.customerName} | status=${r.bookingStatus}`);
  }
}
