/**
 * importBookingsCsv.mjs
 *
 * One-time script to import the 5-year bookings CSV into the completed_jobs table.
 *
 * Usage:
 *   node scripts/importBookingsCsv.mjs /path/to/bookings.csv
 *
 * Logic:
 * - Parses each row from the CSV
 * - Normalizes phone to E.164 (+1XXXXXXXXXX)
 * - Maps Frequency string to a clean value
 * - Deduplicates by phone + jobDate (skips already-imported rows)
 * - Inserts in batches of 500 for performance
 * - Creates a single completed_job_batches record for this import
 */

import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const CSV_PATH = process.argv[2] || "/home/ubuntu/upload/bookings_2020-Jan-01-to-2026-Mar-15.csv";
const BATCH_SIZE = 500;

// ── Phone normalization ────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ── Frequency normalization ────────────────────────────────────────────────────
function normalizeFrequency(raw) {
  if (!raw) return "One-time";
  const f = raw.toLowerCase().trim();
  if (f.includes("weekly (20") || f === "weekly") return "Weekly";
  if (f.includes("bi-weekly") || f.includes("biweekly") || f.includes("bi weekly")) return "Bi-weekly";
  if (f.includes("tri-weekly") || f.includes("triweekly") || f.includes("tri weekly")) return "Tri-weekly";
  if (f.includes("monthly")) return "Monthly";
  if (f.includes("one time") || f.includes("one-time") || f.includes("onetime")) return "One-time";
  return raw.trim() || "One-time";
}

// ── Date parsing (MM/DD/YYYY → YYYY-MM-DD) ────────────────────────────────────
function parseDate(raw) {
  if (!raw) return null;
  const parts = raw.trim().split("/");
  if (parts.length === 3) {
    const [mm, dd, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

// ── Price parsing ─────────────────────────────────────────────────────────────
function parsePrice(raw) {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : Math.round(n);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading CSV: ${CSV_PATH}`);
  const content = fs.readFileSync(CSV_PATH, { encoding: "utf-8" });
  // Strip BOM if present
  const cleanContent = content.startsWith("\uFEFF") ? content.slice(1) : content;

  const records = parse(cleanContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Parsed ${records.length} rows from CSV`);

  // Connect to DB
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected to database");

  // Create a batch record for this import
  const batchLabel = `csv-import-${new Date().toISOString().slice(0, 10)}`;
  const [batchResult] = await db.execute(
    `INSERT INTO completed_job_batches (filename, jobDate, totalCount)
     VALUES (?, ?, ?)`,
    [batchLabel, new Date().toISOString().slice(0, 10), records.length]
  );
  const batchId = batchResult.insertId;
  console.log(`Created batch #${batchId}: ${batchLabel}`);

  // Build insert rows
  let inserted = 0;
  let skipped = 0;
  let invalidPhone = 0;
  const rows = [];

  for (const rec of records) {
    const phone = normalizePhone(rec["Phone"]);
    if (!phone) {
      invalidPhone++;
      continue;
    }

    const jobDate = parseDate(rec["Date"]);
    const frequency = normalizeFrequency(rec["Frequency"]);
    const firstName = (rec["First Name"] || "").trim() || null;
    const lastName = (rec["Last Name"] || "").trim() || null;
    const fullName = (rec["Full Name"] || "").trim() || [firstName, lastName].filter(Boolean).join(" ") || null;
    const email = (rec["Email"] || "").trim() || null;
    const address = [rec["Address"], rec["City"], rec["State"], rec["Postal Code"]]
      .filter(Boolean)
      .map((s) => s.trim())
      .join(", ") || null;
    const lastBookingPrice = parsePrice(rec["Final Amount"] || rec["Amount Paid by the Customer"]);

    rows.push([
      batchId,
      phone,
      fullName,
      firstName,
      email,
      address,
      frequency,
      jobDate,
      lastBookingPrice,
      "PENDING",
      0, // reactivationEligible — will be computed by always-on engine
    ]);
  }

  console.log(`Prepared ${rows.length} rows (${invalidPhone} skipped — invalid phone)`);

  // Insert in batches, skipping duplicates (phone + jobDate)
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flat = chunk.flat();

    try {
      const [result] = await db.execute(
        `INSERT IGNORE INTO completed_jobs
           (batchId, phone, name, firstName, email, address, frequency, jobDate, lastBookingPrice, status, reactivationEligible)
         VALUES ${placeholders}`,
        flat
      );
      inserted += result.affectedRows;
      skipped += chunk.length - result.affectedRows;
    } catch (err) {
      console.error(`Batch ${i}–${i + BATCH_SIZE} error:`, err.message);
    }

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`  Progress: ${i + chunk.length}/${rows.length} rows processed, ${inserted} inserted`);
    }
  }

  // Update batch with actual inserted count
  await db.execute(
    `UPDATE completed_job_batches SET totalCount = ? WHERE id = ?`,
    [inserted, batchId]
  );

  console.log(`\n✅ Import complete:`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Duplicates skipped: ${skipped}`);
  console.log(`   Invalid phone skipped: ${invalidPhone}`);
  console.log(`   Batch ID: ${batchId}`);

  await db.end();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
