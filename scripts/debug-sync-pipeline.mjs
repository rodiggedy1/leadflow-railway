/**
 * Debug script: trace the full sync pipeline for a date to find where bookings are lost.
 * Run: node scripts/debug-sync-pipeline.mjs [YYYY-MM-DD]
 */
import { config } from "dotenv";
config({ path: ".env" });

const date = process.argv[2] || "2026-03-16";
const subdomain = process.env.LAUNCH27_TENANT || "maidsinblack";
const bearer = process.env.LAUNCH27_BEARER_TOKEN;
const baseUrl = `https://${subdomain}.launch27.com`;

console.log(`\n=== Sync Pipeline Debug for ${date} ===\n`);

// Step 1: Fetch raw bookings
const params = new URLSearchParams({
  from: date,
  to: date,
  options: "completed,exclude_forecasted",
  limit: "20",
  offset: "0",
  sort: "asc",
});
const resp = await fetch(`${baseUrl}/v1/staff/bookings?${params}`, {
  headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
});
const raw = await resp.json();
console.log(`Step 1 — API returned: ${raw.length} bookings`);

// Step 2: Map to our format (same as launch27.ts)
const bookings = raw.map(b => ({
  id: b.id,
  phone: b.phone ?? "",
  firstName: b.user?.first_name ?? "",
  lastName: b.user?.last_name ?? "",
  fullName: b.user?.name ?? `${b.user?.first_name ?? ""} ${b.user?.last_name ?? ""}`.trim(),
  email: b.user?.email ?? "",
  serviceDate: b.service_date ?? date,
  frequency: b.frequency?.name ?? "",
  address: b.address?.full_address ?? "",
  totalRevenue: b.summary?.total ?? 0,
  bookingStatus: b.booking_status ?? "completed",
}));

console.log(`\nStep 2 — Mapped bookings:`);
bookings.forEach((b, i) => {
  console.log(`  [${i}] id=${b.id}, phone="${b.phone}", name="${b.fullName}", serviceDate=${b.serviceDate}`);
});

// Step 3: Phone extraction (same logic as routers.ts extractUSDigits / isValidUSPhone)
function extractUSDigits(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
function isValidUSPhone(digits) {
  if (!digits || digits.length !== 10) return false;
  const areaCode = digits.substring(0, 3);
  const exchange = digits.substring(3, 6);
  if (areaCode === "000" || exchange === "000") return false;
  if (areaCode[0] === "0" || areaCode[0] === "1") return false;
  return true;
}

console.log(`\nStep 3 — Phone validation:`);
const validBookings = [];
for (const b of bookings) {
  const digits = extractUSDigits(b.phone);
  const valid = digits !== null && isValidUSPhone(digits);
  console.log(`  id=${b.id}, phone="${b.phone}" → digits="${digits}" → valid=${valid}`);
  if (valid) validBookings.push({ ...b, normalizedPhone: `+1${digits}` });
}
console.log(`  Valid: ${validBookings.length} / ${bookings.length}`);

// Step 4: Check what's already in the DB for these phones + date
if (validBookings.length > 0) {
  console.log(`\nStep 4 — Checking DB for existing records...`);
  try {
    const mysql = await import("mysql2/promise");
    const db = await mysql.createConnection(process.env.DATABASE_URL);
    
    for (const b of validBookings) {
      const jobDate = new Date(b.serviceDate).toISOString().slice(0, 10);
      const [rows] = await db.execute(
        "SELECT id, phone, job_date FROM completed_jobs WHERE phone = ? AND job_date = ?",
        [b.normalizedPhone, jobDate]
      );
      const exists = rows.length > 0;
      console.log(`  id=${b.id}, phone=${b.normalizedPhone}, jobDate=${jobDate} → DB exists=${exists} (${rows.length} rows)`);
    }
    
    await db.end();
  } catch (err) {
    console.log(`  DB check failed: ${err.message}`);
    console.log(`  (This is OK if the DB uses a different column naming convention)`);
    
    // Try camelCase column names
    try {
      const mysql = await import("mysql2/promise");
      const db = await mysql.createConnection(process.env.DATABASE_URL);
      
      for (const b of validBookings) {
        const jobDate = new Date(b.serviceDate).toISOString().slice(0, 10);
        const [rows] = await db.execute(
          "SELECT id, phone, jobDate FROM completed_jobs WHERE phone = ? AND jobDate = ?",
          [b.normalizedPhone, jobDate]
        );
        const exists = rows.length > 0;
        console.log(`  id=${b.id}, phone=${b.normalizedPhone}, jobDate=${jobDate} → DB exists=${exists} (${rows.length} rows)`);
      }
      
      await db.end();
    } catch (err2) {
      console.log(`  DB check also failed with camelCase: ${err2.message}`);
    }
  }
}

// Step 5: Check the serviceDate → jobDate conversion
console.log(`\nStep 5 — serviceDate → jobDate conversion:`);
for (const b of bookings) {
  const rawDate = b.serviceDate;
  const converted = new Date(rawDate).toISOString().slice(0, 10);
  console.log(`  serviceDate="${rawDate}" → jobDate="${converted}" (matches target: ${converted === date})`);
}

console.log(`\n=== Done ===`);
