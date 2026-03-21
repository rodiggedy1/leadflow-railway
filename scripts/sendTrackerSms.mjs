/**
 * One-off script: send the tracker link SMS to a specific phone number.
 * Usage: node scripts/sendTrackerSms.mjs
 */
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const OPENPHONE_API_URL = "https://api.openphone.com/v1/messages";
const apiKey = process.env.OPENPHONE_API_KEY;
const fromNumberId = process.env.OPENPHONE_PHONE_NUMBER_ID;

if (!apiKey || !fromNumberId) {
  console.error("Missing OPENPHONE_API_KEY or OPENPHONE_PHONE_NUMBER_ID");
  process.exit(1);
}

const to = "+13029816191";
const trackerUrl = "https://quote.maidinblack.com/track/test-tracker-preview-token-2026";
const content = `Hi Jane! Your Maids in Black team is confirmed. Track your clean in real time here: ${trackerUrl}`;

console.log(`Sending to ${to}...`);
const response = await fetch(OPENPHONE_API_URL, {
  method: "POST",
  headers: {
    Authorization: apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    content,
    from: fromNumberId,
    to: [to],
    setInboxStatus: "done",
  }),
});

const body = await response.json();
if (response.ok) {
  console.log("✅ SMS sent successfully:", body?.data?.id ?? JSON.stringify(body));
} else {
  console.error("❌ SMS failed:", response.status, JSON.stringify(body));
}
