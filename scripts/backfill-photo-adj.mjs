/**
 * Backfill photoAdjustment for existing cleaner_jobs that have photos
 * but no photoAdjustment saved (because the old code only calculated
 * pay when a rating arrived).
 *
 * Run once: node scripts/backfill-photo-adj.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const PHOTO_BONUS = 5;
const NO_PHOTO_PENALTY = -10;

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all jobs with photoSubmitted=1 but no photoAdjustment
const [rows] = await conn.execute(
  `SELECT id, basePay, payPercent, jobRevenue, photoSubmitted, photoAdjustment, 
          ratingAdjustment, streakBonus, finalPay, customerRating
   FROM cleaner_jobs 
   WHERE photoSubmitted = 1 AND photoAdjustment IS NULL`
);

console.log(`Found ${rows.length} jobs needing photoAdjustment backfill`);

let updated = 0;
for (const job of rows) {
  const photoAdj = PHOTO_BONUS; // photoSubmitted = 1
  const base = parseFloat(job.basePay ?? "0");
  const ratingAdj = parseFloat(job.ratingAdjustment ?? "0");
  const streak = parseFloat(job.streakBonus ?? "0");
  const newFinalPay = Math.round((base + photoAdj + ratingAdj + streak) * 100) / 100;

  await conn.execute(
    `UPDATE cleaner_jobs SET photoAdjustment = ?, finalPay = ? WHERE id = ?`,
    [String(photoAdj), String(newFinalPay), job.id]
  );
  console.log(`  Job ${job.id}: photoAdj=+${photoAdj}, finalPay=${newFinalPay} (was ${job.finalPay})`);
  updated++;
}

// Also backfill jobs with photoSubmitted=0 and no photoAdjustment (no-photo penalty)
const [noPhotoRows] = await conn.execute(
  `SELECT id, basePay, ratingAdjustment, streakBonus, finalPay
   FROM cleaner_jobs 
   WHERE photoSubmitted = 0 AND photoAdjustment IS NULL AND basePay IS NOT NULL`
);

console.log(`\nFound ${noPhotoRows.length} jobs needing no-photo penalty backfill`);
for (const job of noPhotoRows) {
  const photoAdj = NO_PHOTO_PENALTY;
  const base = parseFloat(job.basePay ?? "0");
  const ratingAdj = parseFloat(job.ratingAdjustment ?? "0");
  const streak = parseFloat(job.streakBonus ?? "0");
  const newFinalPay = Math.round((base + photoAdj + ratingAdj + streak) * 100) / 100;

  await conn.execute(
    `UPDATE cleaner_jobs SET photoAdjustment = ?, finalPay = ? WHERE id = ?`,
    [String(photoAdj), String(newFinalPay), job.id]
  );
  console.log(`  Job ${job.id}: photoAdj=${photoAdj}, finalPay=${newFinalPay} (was ${job.finalPay})`);
  updated++;
}

console.log(`\nDone. Updated ${updated} jobs total.`);
await conn.end();
