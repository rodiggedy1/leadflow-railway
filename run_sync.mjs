/**
 * run_sync.mjs — manually run runSyncTodayJobs for a date and show result
 * Usage: node run_sync.mjs [YYYY-MM-DD]
 */
import { config } from "dotenv";
config();

const date = process.argv[2] ?? "2026-05-03";

// Dynamically import the compiled TS via tsx
// Import only the standalone function, not the full router (avoids circular dep)
const mod = await import("./server/qualityRouter.ts");
const { runSyncTodayJobs } = mod;

console.log(`Running runSyncTodayJobs for ${date}...`);
const result = await runSyncTodayJobs(date);
console.log(JSON.stringify(result, null, 2));
