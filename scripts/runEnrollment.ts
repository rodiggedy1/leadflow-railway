/**
 * runEnrollment.ts
 *
 * One-time script to trigger always-on enrollment for all completed_jobs.
 * Run after a bulk CSV import to classify all contacts into the 4 groups.
 *
 * Usage:
 *   npx tsx scripts/runEnrollment.ts
 */

import { enrollNewlyEligible } from "../server/alwaysOnEngine";

async function main() {
  console.log("Starting always-on enrollment...");
  const result = await enrollNewlyEligible();
  const total = Object.values(result).reduce((a, b) => a + b, 0);
  console.log("\n✅ Enrollment complete:");
  console.log(`   New One-Time:      ${result["new-one-time"]}`);
  console.log(`   Lapsed One-Time:   ${result["lapsed-one-time"]}`);
  console.log(`   Lapsed Recurring:  ${result["lapsed-recurring"]}`);
  console.log(`   Dormant:           ${result["dormant"]}`);
  console.log(`   TOTAL:             ${total}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Enrollment failed:", err);
  process.exit(1);
});
