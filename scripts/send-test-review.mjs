/**
 * One-off script: send a test review SMS to a specific number.
 * Usage: node scripts/send-test-review.mjs
 */
import "dotenv/config";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID;

if (!OPENPHONE_API_KEY || !OPENPHONE_PHONE_NUMBER_ID) {
  console.error("Missing OPENPHONE_API_KEY or OPENPHONE_PHONE_NUMBER_ID");
  process.exit(1);
}

const TO = "+13029816191";
const NAME = "there"; // generic for test
const MESSAGE = `Hi ${NAME}! 🏠 How did your cleaning go today? We'd love to hear your feedback — just reply and let us know!`;

console.log(`Sending review SMS to ${TO}...`);
console.log(`Message: ${MESSAGE}`);

const res = await fetch("https://api.openphone.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: OPENPHONE_API_KEY,
  },
  body: JSON.stringify({
    to: [TO],
    from: OPENPHONE_PHONE_NUMBER_ID,
    content: MESSAGE,
  }),
});

const data = await res.json();
if (res.ok) {
  console.log("✅ SMS sent successfully!");
  console.log("Message ID:", data?.data?.id);
} else {
  console.error("❌ Failed to send SMS:", JSON.stringify(data, null, 2));
}
