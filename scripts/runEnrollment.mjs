/**
 * runEnrollment.mjs
 *
 * One-time script to trigger always-on enrollment for all completed_jobs.
 * Run after a bulk CSV import to classify all contacts into the 4 groups.
 *
 * Usage:
 *   node scripts/runEnrollment.mjs
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// We need to call the enrollNewlyEligible function directly
// Since it uses TypeScript imports, we'll use tsx to run it
import { createRequire } from "module";
import { execSync } from "child_process";

console.log("Running always-on enrollment...");

try {
  const result = execSync(
    `cd ${path.resolve(__dirname, "..")} && npx tsx -e "
import { enrollNewlyEligible } from './server/alwaysOnEngine.ts';
const result = await enrollNewlyEligible();
console.log(JSON.stringify(result));
"`,
    { encoding: "utf-8", timeout: 300000 }
  );
  
  const lines = result.trim().split("\n");
  const jsonLine = lines.find(l => l.startsWith("{"));
  if (jsonLine) {
    const enrolled = JSON.parse(jsonLine);
    const total = Object.values(enrolled).reduce((a, b) => a + b, 0);
    console.log("\n✅ Enrollment complete:");
    console.log(`   New One-Time:      ${enrolled["new-one-time"]}`);
    console.log(`   Lapsed One-Time:   ${enrolled["lapsed-one-time"]}`);
    console.log(`   Lapsed Recurring:  ${enrolled["lapsed-recurring"]}`);
    console.log(`   Dormant:           ${enrolled["dormant"]}`);
    console.log(`   Total enrolled:    ${total}`);
  } else {
    console.log(result);
  }
} catch (err) {
  console.error("Enrollment failed:", err.message);
  if (err.stdout) console.log("stdout:", err.stdout);
  if (err.stderr) console.log("stderr:", err.stderr);
  process.exit(1);
}
