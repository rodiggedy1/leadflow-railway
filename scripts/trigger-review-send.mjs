/**
 * Triggers the real sendPendingReviewSms flow via the /api/cron/review-send endpoint.
 * This ensures a proper conversation session is created and the full flow is active.
 */
import "dotenv/config";

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = "http://localhost:3000";

if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET env var");
  process.exit(1);
}

console.log("Triggering review-send cron endpoint...");

const res = await fetch(`${BASE_URL}/api/cron/review-send`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-cron-secret": CRON_SECRET,
  },
});

const data = await res.json();
console.log("Status:", res.status);
console.log("Response:", JSON.stringify(data, null, 2));
